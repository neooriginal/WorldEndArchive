const express = require('express');
const path = require('path');
const crawler = require('../utils/crawler');
const storage = require('../utils/storage');
const winston = require('winston');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const router = express.Router();
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

// Serve static files
router.use(express.static(path.join(__dirname, 'public')));

// Stats endpoint
router.get('/stats', (req, res) => {
    const crawlerStats = crawler.getStats();
    storage.getStats((storageStats) => {
        res.json({
            crawler: crawlerStats,
            storage: storageStats,
            uptime: process.uptime()
        });
    });
});

// Add URL endpoint
router.post('/add-url', express.json(), (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    try {
        new URL(url); // Validate URL
        crawler.addToQueue(url, true); // Add with priority
        logger.info(`Manual URL added: ${url}`);
        res.json({ success: true, message: 'URL added to queue with priority.' });
    } catch (e) {
        res.status(400).json({ error: 'Invalid URL format' });
    }
});

// Download endpoints
router.get('/download/txt', (req, res) => {
    const file = storage.txtPath;
    if (fs.existsSync(file)) {
        res.download(file, 'archive.txt');
    } else {
        res.status(404).send('Archive file not found yet.');
    }
});

router.get('/download/db', (req, res) => {
    const file = storage.dbPath;
    if (fs.existsSync(file)) {
        res.download(file, 'archive.db');
    } else {
        res.status(404).send('Database file not found yet.');
    }
});

module.exports = router;

// Standalone server startup if needed, but usually called from index.js
// We'll export the app setup function or just the router
const app = express();
app.use(express.json());
app.use('/', router);

const PORT = process.env.PORT || 3000;

function startServer() {
    app.listen(PORT, () => {
        logger.info(`Web interface running on port ${PORT}`);
    });
}

module.exports = { startServer, app };
const fs = require('fs'); // Added missing require
