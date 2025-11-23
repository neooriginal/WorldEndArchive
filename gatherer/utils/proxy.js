const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentIndex = 0;
        this.loadProxies();
    }

    loadProxies() {
        const proxyFile = process.env.PROXY_FILE ? path.resolve(__dirname, '../', process.env.PROXY_FILE) : path.resolve(__dirname, '../proxies.txt');

        if (process.env.USE_PROXIES === 'true') {
            try {
                if (fs.existsSync(proxyFile)) {
                    const data = fs.readFileSync(proxyFile, 'utf8');
                    this.proxies = data.split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0 && !line.startsWith('#'));
                    logger.info(`Loaded ${this.proxies.length} proxies.`);
                } else {
                    logger.warn(`Proxy file not found at ${proxyFile}. Proceeding without proxies.`);
                }
            } catch (error) {
                logger.error(`Error loading proxies: ${error.message}`);
            }
        } else {
            logger.info('Proxy usage disabled in configuration.');
        }
    }

    getProxy() {
        if (this.proxies.length === 0) {
            return null;
        }

        // Simple round-robin or random
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

        logger.info(`Using proxy: ${proxy}`); // Debug log

        // Parse proxy string if needed (assuming format protocol://user:pass@host:port or host:port)
        // For axios, we need an object { protocol, host, port, auth }
        // But often axios takes a connection string too if configured right, 
        // or we parse it here.
        // Let's assume standard URL format for now.

        return proxy;
    }

    // Helper to parse proxy string to axios config if needed
    parseProxy(proxyUrl) {
        if (!proxyUrl) return null;

        // Handle IP:PORT:USER:PASS format
        const parts = proxyUrl.split(':');
        if (parts.length === 4) {
            return {
                protocol: 'http',
                host: parts[0],
                port: parseInt(parts[1]),
                auth: {
                    username: parts[2],
                    password: parts[3]
                }
            };
        } else if (parts.length === 2) {
            return {
                protocol: 'http',
                host: parts[0],
                port: parseInt(parts[1])
            };
        }

        // Fallback to URL parsing
        try {
            const url = new URL(proxyUrl.startsWith('http') ? proxyUrl : `http://${proxyUrl}`);
            return {
                protocol: url.protocol.replace(':', ''),
                host: url.hostname,
                port: url.port,
                auth: (url.username && url.password) ? {
                    username: url.username,
                    password: url.password
                } : undefined
            };
        } catch (e) {
            logger.error(`Invalid proxy format: ${proxyUrl}`);
            return null;
        }
    }
    removeProxy(proxy) {
        const index = this.proxies.indexOf(proxy);
        if (index > -1) {
            this.proxies.splice(index, 1);
            logger.warn(`Removed bad proxy: ${proxy}. Remaining: ${this.proxies.length}`);
            // Adjust index if needed
            if (this.currentIndex >= index && this.currentIndex > 0) {
                this.currentIndex--;
            }
        }
    }
}

module.exports = new ProxyManager();
