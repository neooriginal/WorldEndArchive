const crawler = require('./utils/crawler');
const storage = require('./utils/storage');
const webApi = require('./web/api');
const winston = require('winston');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(__dirname, 'output', 'combined.log') })
    ]
});

async function main() {
    logger.info('Starting WorldEndArchive...');

    // 1. Start Web Interface
    webApi.startServer();

    // 2. Setup Event Listeners
    crawler.on('document', (data) => {
        storage.savePage(data);
    });

    crawler.on('image', (data) => {
        storage.saveImage(data.url, data.contentType, data.data);
    });

    // 3. Load Initial Seeds (if any) or wait for manual input
    // For now, we can seed from a file or just wait.
    // Let's seed with a few safe defaults if queue is empty?
    // Or maybe just wait for user input via Web UI as requested.
    // "Add the ability to add a link for scraping from the web interface which shall be prioritized"

    // Let's add a default seed if provided in env or just log that it's ready
    if (process.env.INITIAL_SEED) {
        crawler.addToQueue(process.env.INITIAL_SEED);
    } else {
        logger.info('No initial seed provided. Please add URLs via the Web Interface.');
    }

    // 4. Start Crawler
    crawler.start();

    // 5. Graceful Shutdown
    const shutdown = () => {
        logger.info('Shutting down...');
        crawler.stop();
        // Close DB connection if needed (sqlite3 usually handles it, but good practice)
        storage.db.close((err) => {
            if (err) logger.error(err.message);
            logger.info('Database closed.');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    logger.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
