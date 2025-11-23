const axios = require('axios');
const cheerio = require('cheerio');
const proxyManager = require('./proxy');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

class Scraper {
    constructor() {
        this.userAgent = process.env.USER_AGENT || 'WorldEndArchive/1.0';
    }

    async fetchPage(url) {
        const proxy = proxyManager.getProxy();
        const config = {
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            validateStatus: status => status < 500 // Resolve even if 404 to handle it gracefully
        };

        if (proxy) {
            const proxyConfig = proxyManager.parseProxy(proxy);
            if (proxyConfig) {
                config.proxy = proxyConfig;
                // logger.info(`Using proxy: ${proxyConfig.host}:${proxyConfig.port}`);
            }
        }

        const controller = new AbortController();
        config.signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            // logger.info(`Fetching ${url} via ${proxy || 'direct'}...`);
            const response = await axios.get(url, config);
            clearTimeout(timeoutId);
            // logger.info(`Fetched ${url} status: ${response.status}`);
            return {
                url: response.config.url, // Final URL after redirects
                status: response.status,
                headers: response.headers,
                data: response.data
            };
        } catch (error) {
            clearTimeout(timeoutId);
            if (proxy) {
                logger.warn(`Proxy failed (${proxy}): ${error.message}`);
                proxyManager.removeProxy(proxy);
            } else {
                logger.error(`Failed to fetch ${url}: ${error.message}`);
            }
            return null;
        }
    }

    async fetchImage(url) {
        const proxy = proxyManager.getProxy();
        const config = {
            responseType: 'arraybuffer',
            timeout: 5000,
            validateStatus: status => status === 200
        };

        if (proxy) {
            const proxyConfig = proxyManager.parseProxy(proxy);
            if (proxyConfig) config.proxy = proxyConfig;
        }

        try {
            const response = await axios.get(url, config);
            return {
                data: response.data,
                contentType: response.headers['content-type']
            };
        } catch (error) {
            // logger.warn(`Failed to fetch image ${url}: ${error.message}`);
            return null;
        }
    }

    parseHtml(html, baseUrl) {
        const $ = cheerio.load(html);

        // Remove scripts, styles, and other non-content elements
        $('script, style, noscript, iframe, svg, nav, footer, header, aside, .sidebar, .menu, .ad, .advertisement, .cookie-notice, .popup, .modal, .comments, .related-posts').remove();

        // Extract text from specific content areas if possible, otherwise body
        let content = $('main, article, #content, .content, .post-body').first();
        if (content.length === 0) {
            content = $('body');
        }

        const title = $('title').text().trim();
        // Get body text, collapsing whitespace
        const text = content.text().replace(/\s+/g, ' ').trim();

        // Extract links
        const links = [];
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                // Only keep http/https links
                if (absoluteUrl.startsWith('http')) {
                    links.push(absoluteUrl);
                }
            } catch (e) { }
        });

        // Extract important images
        const images = [];
        $('img[src]').each((i, el) => {
            const src = $(el).attr('src');
            const alt = $(el).attr('alt') || '';
            const titleAttr = $(el).attr('title') || '';

            // Filter for "important" keywords
            const combined = `${src} ${alt} ${titleAttr}`.toLowerCase();
            const keywords = ['map', 'chart', 'diagram', 'schematic', 'guide', 'survival', 'technique', 'knot', 'plant', 'mushroom'];

            if (keywords.some(k => combined.includes(k))) {
                try {
                    const absoluteUrl = new URL(src, baseUrl).href;
                    if (absoluteUrl.startsWith('http')) {
                        images.push(absoluteUrl);
                    }
                } catch (e) { }
            }
        });

        // Return structured data
        return {
            title,
            text,
            links: [...new Set(links)], // Deduplicate links
            images: [...new Set(images)], // Deduplicate
            html: html // Keep original HTML for DB
        };
    }
}

module.exports = new Scraper();
