const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const zlib = require('zlib');
const cheerio = require('cheerio');

const app = express();
const PORT = 3001;

// DB Path (relative to client dir: ../gatherer/output/archive.db)
const DB_PATH = path.resolve(__dirname, '../gatherer/output/archive.db');

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error(`Error opening database at ${DB_PATH}: ${err.message}`);
    } else {
        console.log('Connected to archive database.');
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Homepage - Search and Recent
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Search
app.get('/api/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    const sql = `SELECT id, title, url, timestamp FROM pages WHERE title LIKE ? OR url LIKE ? LIMIT 50`;
    db.all(sql, [`%${query}%`, `%${query}%`], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Recent
app.get('/api/recent', (req, res) => {
    const sql = `SELECT id, title, url, timestamp FROM pages ORDER BY timestamp DESC LIMIT 20`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// View Page
app.get('/view/:id', (req, res) => {
    const id = req.params.id;
    const sql = `SELECT content, url FROM pages WHERE id = ?`;

    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).send('Database error');
        if (!row) return res.status(404).send('Page not found');

        // Decompress
        zlib.gunzip(row.content, (err, buffer) => {
            if (err) return res.status(500).send('Decompression error');

            const html = buffer.toString();
            const $ = cheerio.load(html);

            // Ensure head exists
            if ($('head').length === 0) {
                $('html').prepend('<head></head>');
            }

            // Inject Reader CSS
            $('head').append('<link rel="stylesheet" href="/reader.css">');
            // Inject Viewport meta for mobile
            $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');

            // Rewrite links to point to local viewer if possible
            // This is tricky without knowing the IDs of other pages.
            // For now, we'll just disable external links or leave them as is.
            // Ideally, we'd lookup the ID for each link, but that's expensive.
            // A better approach: Client-side click interception or a "search for this URL" link.

            // Inject Header
            $('body').prepend(`
                <div style="background: #0d1117; color: #58a6ff; padding: 10px; border-bottom: 1px solid #30363d; font-family: monospace; position: sticky; top: 0; z-index: 9999; margin-bottom: 20px;">
                    <a href="/" style="color: #58a6ff; text-decoration: none; font-weight: bold;">&larr; WorldEndArchive</a>
                    <span style="margin-left: 20px; color: #8b949e;">Archived: ${row.url}</span>
                </div>
            `);

            res.send($.html());
        });
    });
});

app.listen(PORT, () => {
    console.log(`Reader client running on http://localhost:${PORT}`);
});
