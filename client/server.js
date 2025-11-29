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

// Check and create FTS5 table for efficient search (run once on startup)
const dbWrite = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database for FTS setup:', err.message);
    } else {
        // Check if FTS table exists
        dbWrite.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pages_fts'", (err, row) => {
            if (!row) {
                console.log('Creating FTS5 table for fast search...');
                dbWrite.exec(`
                    CREATE VIRTUAL TABLE pages_fts USING fts5(title, url, content=pages, content_rowid=id);
                    INSERT INTO pages_fts(rowid, title, url) SELECT id, title, url FROM pages;
                `, (err) => {
                    if (err) {
                        console.error('Error creating FTS table:', err.message);
                    } else {
                        console.log('FTS5 table created successfully.');
                    }
                    dbWrite.close();
                });
            } else {
                console.log('FTS5 table already exists.');
                dbWrite.close();
            }
        });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Homepage - Search and Recent
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Search with FTS5
app.get('/api/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    // Prepare FTS5 query: tokenize and add wildcards for partial matching
    const tokens = query
        .trim()
        .split(/\s+/)
        .map(token => {
            // Escape special FTS5 characters
            const escaped = token.replace(/[:"*]/g, '');
            if (escaped.length === 0) return null;
            // Add wildcard for partial matching
            return `${escaped}*`;
        })
        .filter(t => t !== null);

    if (tokens.length === 0) return res.json([]);

    // Create FTS query: search in both title and url with OR logic
    const ftsQuery = tokens.map(t => `title:${t} OR url:${t}`).join(' OR ');

    // Use FTS5 for efficient search with relevance ranking
    const sql = `
        SELECT pages.id, pages.title, pages.url, pages.timestamp, 
               rank AS relevance
        FROM pages_fts
        JOIN pages ON pages_fts.rowid = pages.id
        WHERE pages_fts MATCH ?
        ORDER BY rank
        LIMIT 50
    `;

    db.all(sql, [ftsQuery], (err, rows) => {
        if (err) {
            console.error('FTS search error:', err.message);
            // Fallback to LIKE search if FTS fails
            const fallbackSql = `SELECT id, title, url, timestamp FROM pages WHERE title LIKE ? OR url LIKE ? LIMIT 50`;
            db.all(fallbackSql, [`%${query}%`, `%${query}%`], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows);
            });
        } else {
            res.json(rows);
        }
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
    const sql = `SELECT content, url, timestamp FROM pages WHERE id = ?`;

    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).send('Database error');
        if (!row) return res.status(404).send('Page not found');

        zlib.gunzip(row.content, (err, buffer) => {
            if (err) return res.status(500).send('Decompression error');

            const html = buffer.toString();
            const $ = cheerio.load(html);

            // Security: Remove all scripts and event handlers
            $('script').remove();
            $('*').each((i, el) => {
                const attribs = el.attribs;
                for (const name in attribs) {
                    if (name.startsWith('on')) {
                        $(el).removeAttr(name);
                    }
                }
            });

            if ($('head').length === 0) {
                $('html').prepend('<head></head>');
            }

            $('head').append('<link rel="stylesheet" href="/reader.css">');
            $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
            $('head').append('<link rel="preconnect" href="https://fonts.googleapis.com">');
            $('head').append('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
            $('head').append('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">');

            const archiveDate = new Date(row.timestamp).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            $('body').prepend(`
                <div style="background: rgba(0,0,0,0.9); backdrop-filter: blur(10px); color: #00f2ff; padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); font-family: 'Inter', sans-serif; position: sticky; top: 0; z-index: 9999; margin-bottom: 20px;">
                    <a href="/" style="color: #00f2ff; text-decoration: none; font-weight: 600; font-size: 1.1rem;">&larr; WorldEndArchive</a>
                    <div style="margin-top: 5px; font-size: 0.85rem;">
                        <span style="color: #a0a0a0;">Archived: ${archiveDate}</span>
                        <span style="margin-left: 15px; color: #606060; font-family: 'JetBrains Mono', monospace;">${row.url}</span>
                    </div>
                </div>
            `);

            res.send($.html());
        });
    });
});

app.listen(PORT, () => {
    console.log(`Reader client running on http://localhost:${PORT}`);
});
