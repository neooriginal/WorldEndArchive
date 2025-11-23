const EventEmitter = require('events');
const robotsParser = require('robots-parser');
const scraper = require('./scraper');
const classifier = require('./classifier');
const winston = require('winston');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

class Crawler extends EventEmitter {
    constructor() {
        super();
        this.queue = []; // Priority queue could be better, but array for simplicity
        this.visited = new Set();
        this.activeRequests = 0;
        this.maxConcurrency = parseInt(process.env.MAX_CONCURRENCY) || 5;
        this.delay = parseInt(process.env.DELAY_BETWEEN_REQUESTS_MS) || 1000;
        this.robotsCache = new Map(); // Domain -> RobotsParser instance
        this.isRunning = false;
        this.domainCounts = new Map(); // Domain -> count to prevent loops
    }

    addToQueue(url, priority = false) {
        if (this.visited.has(url)) return;

        if (classifier.isIgnored(url)) {
            logger.info(`Ignored domain: ${url}`);
            return;
        }

        if (priority) {
            this.queue.unshift(url);
        } else {
            this.queue.push(url);
        }

        this.visited.add(url);
        this.processQueue();
    }

    async processQueue() {
        if (!this.isRunning) return;
        if (this.activeRequests >= this.maxConcurrency) return;
        if (this.queue.length === 0) return;

        const url = this.queue.shift();
        this.activeRequests++;

        try {
            await this.crawl(url);
        } catch (error) {
            logger.error(`Error crawling ${url}: ${error.message}`);
        } finally {
            this.activeRequests--;
            setTimeout(() => this.processQueue(), this.delay);
        }
    }

    async crawl(url) {
        // Check robots.txt
        const allowed = await this.checkRobots(url);
        if (!allowed) {
            logger.info(`Blocked by robots.txt: ${url}`);
            return;
        }

        // Domain throttling/loop prevention
        const domain = new URL(url).hostname;
        const count = this.domainCounts.get(domain) || 0;

        // Dynamic probability to skip based on count
        // If count > 5, 20% skip
        // If count > 10, 50% skip
        // If count > 20, 80% skip
        // If count > 50, 95% skip
        let skipProb = 0;
        if (count > 50) skipProb = 0.95;
        else if (count > 20) skipProb = 0.8;
        else if (count > 10) skipProb = 0.5;
        else if (count > 5) skipProb = 0.2;

        if (Math.random() < skipProb) {
            // logger.info(`Skipping ${url} for diversity (Domain count: ${count})`);
            // Re-queue at the end with low priority? Or just drop?
            // Let's drop to encourage exploring other domains
            return;
        }

        this.domainCounts.set(domain, count + 1);

        logger.info(`Crawling: ${url}`);

        const result = await scraper.fetchPage(url);
        if (!result || result.status !== 200) {
            // logger.warn(`Failed to fetch or non-200 status for ${url}`);
            return;
        }

        // logger.info(`Parsing HTML for ${url}...`);
        const parsed = scraper.parseHtml(result.data, url);
        // logger.info(`Parsed ${url}. Links: ${parsed.links.length}`);

        // Emit data for storage
        if (parsed.text.length > 100) { // Only save if substantial content
            this.emit('document', {
                url: result.url,
                title: parsed.title,
                text: parsed.text,
                html: parsed.html,
                links: parsed.links
            });

            // Save important images (max 2)
            if (parsed.images && parsed.images.length > 0) {
                let savedCount = 0;
                for (const imgUrl of parsed.images) {
                    if (savedCount >= 2) break;

                    // Small delay to be polite
                    await new Promise(r => setTimeout(r, 200));

                    const imgData = await scraper.fetchImage(imgUrl);
                    if (imgData) {
                        // We need to access storage manager directly or emit another event
                        // Since 'document' event is handled by index.js which calls storage.savePage
                        // We should probably add a method to storage or emit 'image' event
                        // For simplicity, let's emit an 'image' event
                        this.emit('image', {
                            url: imgUrl,
                            contentType: imgData.contentType,
                            data: imgData.data
                        });
                        savedCount++;
                    }
                }
            }
        }

        // Add new links to queue
        // Shuffle links to prevent depth-first bias on one topic
        const shuffledLinks = parsed.links.sort(() => Math.random() - 0.5);
        for (const link of shuffledLinks) {
            this.addToQueue(link);
        }
    }

    async checkRobots(url) {
        if (process.env.RESPECT_ROBOTS_TXT !== 'true') return true;

        try {
            const origin = new URL(url).origin;
            const robotsUrl = `${origin}/robots.txt`;

            if (!this.robotsCache.has(origin)) {
                const robotsTxt = await scraper.fetchPage(robotsUrl);
                if (robotsTxt && robotsTxt.status === 200) {
                    const parser = robotsParser(robotsUrl, robotsTxt.data);
                    this.robotsCache.set(origin, parser);
                } else {
                    // If no robots.txt, assume allowed
                    this.robotsCache.set(origin, null);
                }
            }

            const parser = this.robotsCache.get(origin);
            if (parser) {
                return parser.isAllowed(url, process.env.USER_AGENT);
            }
            return true;
        } catch (e) {
            logger.warn(`Error checking robots.txt for ${url}: ${e.message}`);
            return true; // Fail open
        }
    }

    start() {
        this.isRunning = true;
        this.processQueue();
        logger.info('Crawler started.');
    }

    stop() {
        this.isRunning = false;
        logger.info('Crawler stopped.');
    }

    getStats() {
        return {
            queueLength: this.queue.length,
            visitedCount: this.visited.size,
            activeRequests: this.activeRequests
        };
    }
}

module.exports = new Crawler();
