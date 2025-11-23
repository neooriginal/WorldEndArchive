const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const winston = require('winston');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

class StorageManager {
    constructor() {
        this.outputDir = process.env.OUTPUT_DIR ? path.resolve(__dirname, '../', process.env.OUTPUT_DIR) : path.resolve(__dirname, '../output');
        this.dbPath = path.join(this.outputDir, 'archive.db');
        this.txtPath = path.join(this.outputDir, 'archive.txt');
        this.maxTxtSize = (parseInt(process.env.MAX_TXT_SIZE_MB) || 50) * 1024 * 1024;

        this.initDir();
        this.initDB();
    }

    initDir() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    initDB() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                logger.error(`Could not connect to database: ${err.message}`);
            } else {
                logger.info('Connected to SQLite database.');
                this.createTables();
            }
        });
    }

    createTables() {
        const sql = `
            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT UNIQUE,
                title TEXT,
                content BLOB, -- Compressed HTML
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_url ON pages(url);

            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT UNIQUE,
                content_type TEXT,
                data BLOB,
                timestamp INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_img_url ON images(url);
        `;
        this.db.exec(sql, (err) => {
            if (err) {
                logger.error(`Error creating tables: ${err.message}`);
            }
        });
    }

    async savePage(pageData) {
        // logger.info(`Saving page: ${pageData.url}`);

        // 1. Save to TXT
        try {
            // Rotate if needed
            if (fs.existsSync(this.txtPath)) {
                const stats = fs.statSync(this.txtPath);
                if (stats.size >= this.maxTxtSize) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const newPath = path.join(this.outputDir, `archive_${timestamp}.txt`);
                    fs.renameSync(this.txtPath, newPath);
                    logger.info(`Rotated TXT file to ${newPath}`);
                }
            }

            const entry = `\n\n=== ${pageData.title} ===\nURL: ${pageData.url}\nDate: ${new Date().toISOString()}\n\n${pageData.text}\n\n==================\n`;
            fs.appendFileSync(this.txtPath, entry);
            logger.info(`Saved to TXT: ${pageData.url}`);
        } catch (e) {
            logger.error(`Error writing to TXT: ${e.message}`);
        }

        // 2. Save to DB
        zlib.gzip(pageData.html, (err, buffer) => {
            if (err) {
                logger.error(`Compression error: ${err.message}`);
                return;
            }

            this.db.run(`INSERT OR IGNORE INTO pages (url, title, content, timestamp) VALUES (?, ?, ?, ?)`,
                [pageData.url, pageData.title, buffer, Date.now()],
                (err) => {
                    if (err) logger.error(`DB Error: ${err.message}`);
                    else logger.info(`Saved to DB: ${pageData.url}`);
                }
            );
        });
    }

    saveImage(url, contentType, data) {
        this.db.run(`INSERT OR IGNORE INTO images (url, content_type, data, timestamp) VALUES (?, ?, ?, ?)`,
            [url, contentType, data, Date.now()],
            (err) => {
                if (err) logger.error(`Image DB Error: ${err.message}`);
                else logger.info(`Saved image: ${url}`);
            }
        );
    }

    getStats(callback) {
        this.db.get("SELECT COUNT(*) as count FROM pages", (err, row) => {
            if (err) {
                callback({ count: 0, size: 0 });
            } else {
                // Get TXT size
                let txtSize = 0;
                try {
                    if (fs.existsSync(this.txtPath)) {
                        txtSize = fs.statSync(this.txtPath).size;
                    }
                } catch (e) { }

                callback({
                    count: row.count,
                    txtSize: txtSize
                });
            }
        });
    }
}

module.exports = new StorageManager();
