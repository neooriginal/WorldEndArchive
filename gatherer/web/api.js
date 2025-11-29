const express = require('express');
const path = require('path');
const crawler = require('../utils/crawler');
const storage = require('../utils/storage');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger, logStream } = require('../utils/logger');

const router = express.Router();

// SSE Endpoint for logs
router.get('/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onLog = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    logStream.on('log', onLog);

    req.on('close', () => {
        logStream.off('log', onLog);
    });
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
    const archiver = require('archiver');
    const outputDir = storage.outputDir;

    // Find all TXT archive files
    const files = fs.readdirSync(outputDir).filter(f =>
        f === 'archive.txt' || f.startsWith('archive_') && f.endsWith('.txt')
    );

    if (files.length === 0) {
        return res.status(404).send('No archive files found yet.');
    }

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.attachment('worldendarchive_txt.zip');
    archive.pipe(res);

    // Add all TXT files to the ZIP
    files.forEach(file => {
        const filePath = path.join(outputDir, file);
        archive.file(filePath, { name: file });
    });

    archive.finalize();
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

module.exports = { startServer, app, logger };
const fs = require('fs'); // Added missing require
