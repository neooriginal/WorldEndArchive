const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { 
  searchPages, 
  getPageContent, 
  getStats, 
  vacuumDatabase
} = require('./database');
const { 
  decompressData, 
  formatSize, 
  getCompressionRatio 
} = require('./compression');
const { 
  getAvailableTopics, 
  getTopicKeywords 
} = require('./classifier');

// Crawler state tracking for statistics
let crawlerStats = {
  isRunning: false,
  lastStartTime: null,
  queueSize: 0,
  processedUrls: 0,
  failedUrls: 0,
  lastProcessedUrl: null,
  crawlSpeed: 0, // pages per minute
  successRate: 100, // percentage
  startTime: null,
  totalRuntime: 0
};

// Database download state tracking to prevent concurrent operations
let isDbDownloading = false;

// Create Express router
const router = express.Router();

/**
 * API Routes
 */

// Search endpoint
router.get('/search', async (req, res) => {
  try {
    const { query, topics } = req.query;
    const topicList = topics ? topics.split(',') : [];
    const limit = parseInt(req.query.limit) || 100;
    
    const results = await searchPages(query, topicList, limit);
    
    // Format results
    const formattedResults = results.map(result => ({
      id: result.id,
      url: result.url,
      title: result.title,
      date: result.date_archived,
      topics: result.topics ? result.topics.split(',') : []
    }));
    
    res.json({ results: formattedResults });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get content endpoint
router.get('/content/:id', async (req, res) => {
  try {
    const page = await getPageContent(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    const { compressed_content, url, title } = page;
    
    // Check content type requested (html or text)
    const format = req.query.format || 'html';
    
    // Decompress content
    const decompressedBuffer = await decompressData(compressed_content);
    const content = decompressedBuffer.toString('utf8');
    
    if (format === 'text') {
      // Strip HTML for text-only view
      const textContent = content.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      res.json({ 
        title, 
        url, 
        content: textContent 
      });
    } else {
      // Return full HTML
      res.send(content);
    }
  } catch (error) {
    console.error('Content retrieval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stats
router.get('/stats', async (req, res) => {
  try {
    const dbStats = await getStats();
    
    // Format stats for frontend
    const stats = {
      totalPages: parseInt(dbStats.total_pages || 0),
      totalSizeRaw: formatSize(parseInt(dbStats.total_size_raw || 0)),
      totalSizeCompressed: formatSize(parseInt(dbStats.total_size_compressed || 0)),
      compressionRatio: getCompressionRatio(
        parseInt(dbStats.total_size_raw || 0), 
        parseInt(dbStats.total_size_compressed || 0)
      ),
      lastCrawlDate: dbStats.last_crawl_date,
      topTopics: dbStats.topTopics || [],
      queueStatus: dbStats.queue || {}
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get topics
router.get('/topics', (req, res) => {
  try {
    const topics = getAvailableTopics();
    
    // Get keywords if detailed mode requested
    const detailed = req.query.detailed === 'true';
    let result;
    
    if (detailed) {
      result = topics.map(topic => ({
        id: topic,
        name: topic.charAt(0).toUpperCase() + topic.slice(1),
        keywords: getTopicKeywords(topic).slice(0, 10) // First 10 keywords
      }));
    } else {
      result = topics.map(topic => ({
        id: topic,
        name: topic.charAt(0).toUpperCase() + topic.slice(1)
      }));
    }
    
    res.json(result);
  } catch (error) {
    console.error('Topics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Maintenance endpoint
router.post('/maintenance', async (req, res) => {
  if (req.body.action === 'vacuum') {
    try {
      await vacuumDatabase();
      res.json({ success: true, message: 'Database optimized' });
    } catch (error) {
      console.error('Maintenance error:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(400).json({ error: 'Unknown maintenance action' });
  }
});

// Download database endpoint
router.get('/download-db', (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.db');
    
    // Check if database exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    
    // Get file size
    const stats = fs.statSync(dbPath);
    const fileSizeInBytes = stats.size;
    
    // Check if crawler is actively writing to the database
    if (crawlerStats.isRunning) {
      res.setHeader('X-Crawler-Active', 'true');
    }
    
    // For HEAD requests, just return headers without starting download
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive.db');
      res.setHeader('Content-Length', fileSizeInBytes);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      return res.end();
    }
    
    // For GET requests, proceed with download
    
    // Prevent concurrent downloads that might corrupt the file
    if (isDbDownloading) {
      return res.status(409).json({ error: 'Another download is already in progress. Please try again later.' });
    }
    
    // Set download flag
    isDbDownloading = true;
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive.db');
    res.setHeader('Content-Length', fileSizeInBytes);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Create read stream with high water mark for better performance
    const fileStream = fs.createReadStream(dbPath, {
      highWaterMark: 64 * 1024 // 64KB chunks for better performance
    });
    
    // Handle potential errors
    fileStream.on('error', (error) => {
      isDbDownloading = false; // Reset flag
     
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming database file' });
      } else {
        // If headers already sent, we need to destroy the connection
        res.destroy();
      }
    });
    
    // Handle when download completes
    fileStream.on('end', () => {
      isDbDownloading = false; // Reset flag
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (isDbDownloading) {
        fileStream.destroy(); // Close the file stream
        isDbDownloading = false; // Reset flag
        console.log('Database download canceled: Client disconnected');
      }
    });
    
    // Start the download
    fileStream.pipe(res);
  } catch (error) {
    isDbDownloading = false; // Reset flag
    console.error('Database download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get crawler status and stats
router.get('/crawler-stats', async (req, res) => {
  try {
    // Get database stats
    const dbStats = await getStats();
    
    // Check if database file exists and get its size
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.db');
    let fileSizeInBytes = 0;
    let dbFileExists = false;
    
    if (fs.existsSync(dbPath)) {
      dbFileExists = true;
      const stats = fs.statSync(dbPath);
      fileSizeInBytes = stats.size;
    }
    
    // Make sure crawlerStats has default values if undefined
    const defaultCrawlerStats = {
      isRunning: false,
      startTime: null,
      totalRuntime: 0,
      queueSize: 0,
      processedUrls: 0,
      crawlSpeed: 0,
      successRate: 100,
      lastProcessedUrl: null,
      infiniteMode: process.env.INFINITE_CRAWL === 'true',
      maxDbSize: (parseInt(process.env.MAX_DB_SIZE_MB) || 8192) * 1024 * 1024
    };
    
    // Combine with actual crawlerStats, using defaults for missing values
    const currentCrawlerStats = {
      ...defaultCrawlerStats,
      ...(crawlerStats || {})
    };
    
    // Check if we should consider the crawler active based on queue status
    // If there are URLs in progress, the crawler is active even if crawlerRunning is false
    if (dbStats.queue && dbStats.queue.in_progress > 0) {
      currentCrawlerStats.isRunning = true;
    }
    
    // Update crawler stats based on database stats
    if (dbStats.processed_pages !== undefined) {
      currentCrawlerStats.processedUrls = parseInt(dbStats.processed_pages) || 0;
    }
    
    // Update queue size from database stats
    if (dbStats.queue) {
      currentCrawlerStats.queueSize = (dbStats.queue.pending || 0) + (dbStats.queue.in_progress || 0);
    }
    
    // Update last URL from database if available
    if (dbStats.last_url) {
      currentCrawlerStats.lastProcessedUrl = dbStats.last_url;
    }
    
    // Get total runtime from database if available
    if (dbStats.total_runtime) {
      currentCrawlerStats.totalRuntime = parseInt(dbStats.total_runtime) || 0;
    }
    
    // Calculate crawl speed based on recent activity
    // If database has growth data, calculate a more realistic crawl speed
    const totalPages = parseInt(dbStats.total_pages || 0);
    const lastCrawlTime = dbStats.last_crawl_date ? new Date(dbStats.last_crawl_date).getTime() : null;
    
    if (lastCrawlTime && currentCrawlerStats.isRunning) {
      // Calculate pages processed in last hour
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentPagesProcessed = parseInt(dbStats.recent_pages_count || 0);
      
      if (recentPagesProcessed > 0) {
        // Calculate pages per minute based on recent activity
        currentCrawlerStats.crawlSpeed = Math.round(recentPagesProcessed / 60);
      } else if (totalPages > 0) {
        // Fallback: Calculate average crawl speed based on total pages and runtime
        const runtime = currentCrawlerStats.totalRuntime;
        if (runtime > 0) {
          // Pages per minute
          currentCrawlerStats.crawlSpeed = Math.round((totalPages / (runtime / 60)) * 10) / 10;
        }
      }
    }
    
    // Format stats to include both database info and crawler status
    const stats = {
      crawler: currentCrawlerStats,
      database: {
        exists: dbFileExists,
        fileSize: formatSize(fileSizeInBytes),
        fileSizeBytes: fileSizeInBytes,
        totalPages: parseInt(dbStats.total_pages || 0),
        totalSizeRaw: formatSize(parseInt(dbStats.total_size_raw || 0)),
        totalSizeRawBytes: parseInt(dbStats.total_size_raw || 0),
        totalSizeCompressed: formatSize(parseInt(dbStats.total_size_compressed || 0)),
        totalSizeCompressedBytes: parseInt(dbStats.total_size_compressed || 0),
        compressionRatio: getCompressionRatio(
          parseInt(dbStats.total_size_raw || 0), 
          parseInt(dbStats.total_size_compressed || 0)
        ),
        lastCrawlDate: dbStats.last_crawl_date,
        topTopics: dbStats.topTopics || [],
        queueStatus: dbStats.queue || {}
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Crawler stats error:', error);
    // Return a valid response structure even on error
    res.json({
      crawler: {
        isRunning: false,
        runtime: 0,
        queueSize: 0,
        processedUrls: 0,
        crawlSpeed: 0,
        successRate: 100,
        lastProcessedUrl: null,
        infiniteMode: process.env.INFINITE_CRAWL === 'true',
        maxDbSize: (parseInt(process.env.MAX_DB_SIZE_MB) || 8192) * 1024 * 1024
      },
      database: {
        exists: false,
        fileSize: '0 B',
        fileSizeBytes: 0,
        totalPages: 0,
        lastCrawlDate: null,
        topTopics: []
      }
    });
  }
});

// Update crawler stats (called by the crawler)
// This endpoint is for internal use
router.post('/update-crawler-stats', (req, res) => {
  try {
    const stats = req.body;
    
    if (stats) {
      // Update our tracking stats
      crawlerStats = {
        ...crawlerStats,
        ...stats
      };
      
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'No stats provided' });
    }
  } catch (error) {
    console.error('Update crawler stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create Express app for standalone API server
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export router for use in index.js
module.exports = router;

// Export API functions separately
module.exports.start = (port = 3000) => {
  app.listen(port, () => {
    console.log(`WorldEndArchive server running on port ${port}`);
  });
};

module.exports.updateCrawlerStats = (stats) => {
  crawlerStats = {
    ...crawlerStats,
    ...stats
  };
}; 