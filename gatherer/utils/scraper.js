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
            validateStatus: status => status < 500
        };

        if (proxy) {
            const proxyConfig = proxyManager.parseProxy(proxy);
            if (proxyConfig) {
                config.proxy = proxyConfig;
            }
        }

        const controller = new AbortController();
        config.signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            const response = await axios.get(url, config);
            clearTimeout(timeoutId);
            return {
                url: response.config.url,
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
        try {
            const urlObj = new URL(baseUrl);
            urlObj.hash = '';
            urlObj.search = '';
            baseUrl = urlObj.href;
        } catch (e) { }

        const $ = cheerio.load(html);

        $('script, style, noscript, iframe, svg, nav, footer, header, aside, .sidebar, .menu, .ad, .advertisement, .cookie-notice, .popup, .modal, .comments, .related-posts').remove();

        let content = $('main, article, #content, .content, .post-body').first();
        if (content.length === 0) {
            content = $('body');
        }

        const title = $('title').text().trim();
        const text = content.text().replace(/\s+/g, ' ').trim();

        const links = [];
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            try {
                const urlObj = new URL(href, baseUrl);
                urlObj.hash = '';
                urlObj.search = '';

                const absoluteUrl = urlObj.href;
                if (absoluteUrl.startsWith('http')) {
                    links.push(absoluteUrl);
                }
            } catch (e) { }
        });

        const images = [];
        $('img[src]').each((i, el) => {
            const src = $(el).attr('src');
            const alt = $(el).attr('alt') || '';
            const titleAttr = $(el).attr('title') || '';

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

        return {
            title,
            text,
            links: [...new Set(links)],
            images: [...new Set(images)],
            html: html
        };
    }
}

module.exports = new Scraper();
