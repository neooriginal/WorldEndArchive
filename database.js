const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3(path.join(DATA_DIR, 'worldend_archive.db'));

// Initialize database schema
function initializeDatabase() {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = 10000');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      compressed_content BLOB,
      content_hash TEXT,
      content_size INTEGER,
      compressed_size INTEGER,
      date_archived DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS page_topics (
      page_id INTEGER,
      topic TEXT,
      confidence REAL DEFAULT 1.0,
      FOREIGN KEY (page_id) REFERENCES pages(id),
      PRIMARY KEY (page_id, topic)
    );
    
    CREATE TABLE IF NOT EXISTS crawl_queue (
      url TEXT PRIMARY KEY,
      parent_url TEXT,
      depth INTEGER,
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt DATETIME
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
    CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages(content_hash);
    CREATE INDEX IF NOT EXISTS idx_page_topics_topic ON page_topics(topic);
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue(status);
  `);
  
  // Initialize settings with defaults if not exists
  const settingsDefaults = {
    'last_crawl_date': new Date(0).toISOString(),
    'total_pages': '0',
    'total_size_raw': '0',
    'total_size_compressed': '0'
  };
  
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(settingsDefaults).forEach(([key, value]) => {
    insertSetting.run(key, value);
  });
}

function urlExists(url) {
  return db.prepare('SELECT 1 FROM pages WHERE url = ?').get(url) !== undefined;
}

function queueExists(url) {
  return db.prepare('SELECT 1 FROM crawl_queue WHERE url = ?').get(url) !== undefined;
}

function insertPage(url, title, compressedContent, contentHash, contentSize, compressedSize, topics) {
  const insertPageStmt = db.prepare(
    'INSERT OR REPLACE INTO pages (url, title, compressed_content, content_hash, content_size, compressed_size, last_checked) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
  );
  
  const insertTopicStmt = db.prepare(
    'INSERT OR REPLACE INTO page_topics (page_id, topic, confidence) VALUES (?, ?, ?)'
  );
  
  // Update statistics
  const updateSetting = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  
  // Use transaction to ensure data consistency
  db.transaction(() => {
    const info = insertPageStmt.run(url, title, compressedContent, contentHash, contentSize, compressedSize);
    const pageId = info.lastInsertRowid;
    
    // Delete existing topics for this page
    db.prepare('DELETE FROM page_topics WHERE page_id = ?').run(pageId);
    
    // Insert new topics
    if (pageId && topics && Object.keys(topics).length) {
      Object.entries(topics).forEach(([topic, confidence]) => {
        insertTopicStmt.run(pageId, topic, confidence);
      });
    }
    
    // Remove from queue if exists
    db.prepare('DELETE FROM crawl_queue WHERE url = ?').run(url);
    
    // Update statistics
    const totalPages = db.prepare('SELECT COUNT(*) as count FROM pages').get().count;
    const sizeStats = db.prepare('SELECT SUM(content_size) as raw, SUM(compressed_size) as compressed FROM pages').get();
    
    updateSetting.run(totalPages.toString(), 'total_pages');
    updateSetting.run(sizeStats.raw.toString(), 'total_size_raw');
    updateSetting.run(sizeStats.compressed.toString(), 'total_size_compressed');
    updateSetting.run(new Date().toISOString(), 'last_crawl_date');
  })();
}

function addToQueue(url, parentUrl, depth, priority = 0) {
  if (queueExists(url) || urlExists(url)) return false;
  
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO crawl_queue (url, parent_url, depth, priority) VALUES (?, ?, ?, ?)'
  );
  
  const result = stmt.run(url, parentUrl, depth, priority);
  return result.changes > 0;
}

function getNextBatchFromQueue(batchSize, maxAttempts = 3) {
  return db.prepare(`
    SELECT url, parent_url, depth 
    FROM crawl_queue 
    WHERE status = 'pending' AND attempts < ? 
    ORDER BY priority DESC, depth ASC 
    LIMIT ?
  `).all(maxAttempts, batchSize);
}

function markUrlInProgress(urls) {
  const stmt = db.prepare(`
    UPDATE crawl_queue 
    SET status = 'in_progress', 
        attempts = attempts + 1,
        last_attempt = CURRENT_TIMESTAMP
    WHERE url = ?
  `);
  
  db.transaction(() => {
    urls.forEach(url => stmt.run(url));
  })();
}

function markUrlFailed(url, error) {
  db.prepare(`
    UPDATE crawl_queue 
    SET status = 'failed', 
        last_attempt = CURRENT_TIMESTAMP
    WHERE url = ?
  `).run(url);
}

function searchPages(query, topics = [], limit = 100) {
  let sql = `
    SELECT p.id, p.url, p.title, p.date_archived,
           GROUP_CONCAT(pt.topic) as topics
    FROM pages p
  `;
  
  const params = [];
  
  if (topics.length > 0) {
    sql += `
      JOIN page_topics pt ON p.id = pt.page_id
      WHERE pt.topic IN (${topics.map(() => '?').join(',')})
    `;
    params.push(...topics);
    
    if (query) {
      sql += ` AND (p.title LIKE ? OR p.url LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`);
    }
    
    sql += ` GROUP BY p.id`;
    
    if (topics.length > 1) {
      sql += ` HAVING COUNT(DISTINCT pt.topic) = ${topics.length}`;
    }
  } else if (query) {
    sql += ` 
      LEFT JOIN page_topics pt ON p.id = pt.page_id
      WHERE (p.title LIKE ? OR p.url LIKE ?)
      GROUP BY p.id
    `;
    params.push(`%${query}%`, `%${query}%`);
  } else {
    sql += ` 
      LEFT JOIN page_topics pt ON p.id = pt.page_id
      GROUP BY p.id
    `;
  }
  
  sql += ` ORDER BY p.date_archived DESC LIMIT ?`;
  params.push(limit);
  
  return db.prepare(sql).all(...params);
}

function getPageContent(id) {
  return db.prepare('SELECT compressed_content, title, url FROM pages WHERE id = ?').get(id);
}

function getStats() {
  const stats = {};
  const settings = db.prepare('SELECT key, value FROM settings').all();
  
  settings.forEach(row => {
    stats[row.key] = row.value;
  });
  
  // Get topic distribution
  stats.topTopics = db.prepare(`
    SELECT topic, COUNT(*) as count 
    FROM page_topics 
    GROUP BY topic 
    ORDER BY count DESC 
    LIMIT 10
  `).all();
  
  // Queue stats
  const queueStats = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM crawl_queue 
    GROUP BY status
  `).all();
  
  stats.queue = {};
  queueStats.forEach(row => {
    stats.queue[row.status] = row.count;
  });
  
  return stats;
}

function vacuumDatabase() {
  // Clean up old failed queue items
  db.prepare(`
    DELETE FROM crawl_queue 
    WHERE status = 'failed' AND 
    last_attempt < datetime('now', '-7 day')
  `).run();
  
  // Run VACUUM to reclaim space
  db.pragma('vacuum');
}

module.exports = {
  initializeDatabase,
  insertPage,
  addToQueue,
  getNextBatchFromQueue,
  markUrlInProgress,
  markUrlFailed,
  searchPages,
  getPageContent,
  urlExists,
  queueExists,
  getStats,
  vacuumDatabase
}; 