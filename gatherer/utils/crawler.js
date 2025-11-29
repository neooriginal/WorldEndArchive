const EventEmitter = require('events');
const robotsParser = require('robots-parser');
const scraper = require('./scraper');
const classifier = require('./classifier');
const LanguageDetect = require('languagedetect');
const lngDetector = new LanguageDetect();
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

const Queue = require('./queue');

class Crawler extends EventEmitter {
    constructor() {
        super();
        this.queue = new Queue();
        this.priorityQueue = [];
        this.visited = new Set();
        this.activeRequests = 0;
        this.maxConcurrency = parseInt(process.env.MAX_CONCURRENCY) || 5;
        this.delay = parseInt(process.env.DELAY_BETWEEN_REQUESTS_MS) || 1000;
        this.robotsCache = new Map(); // Domain -> RobotsParser instance
        this.isRunning = false;
        this.isRunning = false;
        this.domainCounts = new Map(); // Domain -> count to prevent loops
        this.acceptedLanguages = (process.env.ACCEPTED_LANGUAGES || 'en').split(',').map(l => l.trim().toLowerCase());
    }

    addToQueue(url, priority = false) {
        if (this.visited.has(url)) return;

        if (classifier.isIgnored(url)) {
            logger.info(`Ignored domain: ${url}`);
            return;
        }

        // Pre-process URLs to filter out low-quality ones
        if (classifier.isLowQualityUrl(url)) {
            this.visited.add(url);
            return;
        }

        // Queue size limit to prevent unbounded growth
        const currentQueueSize = this.queue.size + (this.priorityQueue ? this.priorityQueue.length : 0);
        const maxQueueSize = parseInt(process.env.MAX_QUEUE_SIZE) || 1000;

        if (!priority && currentQueueSize >= maxQueueSize) {
            // When queue is full, be very aggressive about filtering
            // Only add URLs with 5% probability, and only if from a new domain
            if (Math.random() > 0.05) {
                this.visited.add(url);
                return;
            }

            try {
                const domain = new URL(url).hostname;
                const domainCount = this.domainCounts.get(domain) || 0;
                if (domainCount > 0) {
                    // Already seen this domain, skip it
                    this.visited.add(url);
                    return;
                }
            } catch (e) {
                this.visited.add(url);
                return;
            }
        }

        if (priority) {
            // Use a separate array for priority URLs (processed first in processQueue)
            this.priorityQueue.push(url);
        } else {
            this.queue.enqueue(url);
        }

        this.visited.add(url);
        this.processQueue();
    }

    async processQueue() {
        if (!this.isRunning) return;
        if (this.activeRequests >= this.maxConcurrency) return;

        // Check priority queue first
        let url;
        if (this.priorityQueue && this.priorityQueue.length > 0) {
            url = this.priorityQueue.shift();
        } else if (this.queue.size > 0) {
            url = this.queue.dequeue();
        } else {
            return;
        }

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
        const allowed = await this.checkRobots(url);
        if (!allowed) {
            logger.info(`Blocked by robots.txt: ${url}`);
            return;
        }

        const domain = new URL(url).hostname;
        const count = this.domainCounts.get(domain) || 0;

        let skipProb = 0;
        if (count > 50) skipProb = 0.95;
        else if (count > 20) skipProb = 0.8;
        else if (count > 10) skipProb = 0.5;
        else if (count > 5) skipProb = 0.2;

        if (Math.random() < skipProb) {
            return;
        }

        this.domainCounts.set(domain, count + 1);

        logger.info(`Crawling: ${url}`);

        const result = await scraper.fetchPage(url);
        if (!result || result.status !== 200) {
            return;
        }

        const parsed = scraper.parseHtml(result.data, url);

        // Language Filtering
        const acceptedLangs = this.acceptedLanguages;

        if (parsed.lang) {
            const langCode = parsed.lang.split('-')[0].toLowerCase();
            if (!acceptedLangs.some(l => langCode === l || (l === 'en' && langCode === 'en'))) {
                if (!acceptedLangs.includes(langCode)) {
                    logger.info(`Skipping content (lang=${parsed.lang}): ${url}`);
                    return;
                }
            }
        }

        const detected = lngDetector.detect(parsed.text, 1);
        if (detected && detected.length > 0) {
            const detectedName = detected[0][0].toLowerCase();

            const nameToCode = {
                'english': 'en',
                'spanish': 'es',
                'french': 'fr',
                'german': 'de',
                'italian': 'it',
                'portuguese': 'pt',
                'dutch': 'nl',
                'russian': 'ru',
                'chinese': 'zh',
                'japanese': 'ja'
            };

            const detectedCode = nameToCode[detectedName] || detectedName;

            if (!acceptedLangs.includes(detectedCode)) {
                logger.info(`Skipping content (detected=${detectedName}): ${url}`);
                return;
            }
        }

        if (parsed.text.length > 100) {
            this.emit('document', {
                url: result.url,
                title: parsed.title,
                text: parsed.text,
                html: parsed.html,
                links: parsed.links
            });

            if (parsed.images && parsed.images.length > 0) {
                let savedCount = 0;
                for (const imgUrl of parsed.images) {
                    if (savedCount >= 2) break;

                    await new Promise(r => setTimeout(r, 200));

                    const imgData = await scraper.fetchImage(imgUrl);
                    if (imgData) {
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

                // Limit cache size
                if (this.robotsCache.size > 500) {
                    const firstKey = this.robotsCache.keys().next().value;
                    this.robotsCache.delete(firstKey);
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
            queueLength: this.queue.size + (this.priorityQueue ? this.priorityQueue.length : 0),
            visitedCount: this.visited.size,
            activeRequests: this.activeRequests
        };
    }
}

module.exports = new Crawler();
