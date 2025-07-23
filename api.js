const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { 
  searchPages, 
  getPageContent, 
  getStats, 
  vacuumDatabase,
  createBrowserFriendlyStream
} = require('./jsonDatabase');
const { 
  getAvailableTopics, 
  getTopicKeywords 
} = require('./classifier');

// Helper function to format bytes to human readable form
function formatSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

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
    
    const { html_content, url, title } = page;
    
    // Check content type requested (html or text)
    const format = req.query.format || 'html';
    
    if (format === 'text') {
      // Strip HTML for text-only view
      const textContent = html_content.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      res.json({ 
        title, 
        url, 
        content: textContent 
      });
    } else {
      // Return full HTML
      res.send(html_content);
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

// Download database endpoint with streaming support
router.get('/download-db', (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    const streamMode = req.query.stream === 'true';
    
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
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive.json');
      res.setHeader('Content-Length', fileSizeInBytes);
      res.setHeader('Cache-Control', 'no-cache'); // Don't cache during active crawling
      return res.end();
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive.json');
    res.setHeader('Content-Length', fileSizeInBytes);
    res.setHeader('Cache-Control', 'no-cache'); // Don't cache during active crawling
    
    // Use streaming if requested and file is large
    if (streamMode || fileSizeInBytes > 50 * 1024 * 1024) { // Stream for files > 50MB
      console.log('Using streaming download for large database file');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Stream-Mode', 'true');
    }
    
    // Create read stream with high water mark for better performance
    const fileStream = fs.createReadStream(dbPath, {
      highWaterMark: 256 * 1024 // 256KB chunks for better performance with large files
    });
    
    // Handle potential errors
    fileStream.on('error', (error) => {
      console.error('Database download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming database file' });
      } else {
        res.destroy();
      }
    });
    
    // Handle when download completes
    fileStream.on('end', () => {
      console.log('Database download completed');
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (!fileStream.destroyed) {
        fileStream.destroy();
        console.log('Database download canceled: Client disconnected');
      }
    });
    
    // Start the download
    fileStream.pipe(res);
  } catch (error) {
    console.error('Database download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// New browser-friendly streaming endpoint
router.get('/download-db-chunks', (req, res) => {
  try {
    // Set headers for chunked JSON download
    res.setHeader('Content-Type', 'application/x-ndjson'); // Newline-delimited JSON
    res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive_chunks.ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Chunked-Format', 'true');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Check if crawler is actively writing
    if (crawlerStats.isRunning) {
      res.setHeader('X-Crawler-Active', 'true');
    }
    
    // Create browser-friendly stream
    const browserStream = createBrowserFriendlyStream();
    
    // Handle errors
    browserStream.on('error', (error) => {
      console.error('Browser-friendly download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error creating browser-friendly stream' });
      } else {
        res.destroy();
      }
    });
    
    // Handle completion
    browserStream.on('end', () => {
      console.log('Browser-friendly download completed');
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (!browserStream.destroyed) {
        browserStream.destroy();
        console.log('Browser-friendly download canceled: Client disconnected');
      }
    });
    
    // Start streaming
    browserStream.pipe(res);
  } catch (error) {
    console.error('Browser-friendly download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced stats endpoint with real-time data
router.get('/stats-realtime', async (req, res) => {
  try {
    const dbStats = await getStats();
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    
    // Get real-time file information
    let currentFileSize = 0;
    let lastModified = null;
    
    if (fs.existsSync(dbPath)) {
      const fileStats = fs.statSync(dbPath);
      currentFileSize = fileStats.size;
      lastModified = fileStats.mtime.toISOString();
    }
    
    // Calculate storage progress
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    const storageProgress = (currentFileSize / maxSize) * 100;
    
    // Format enhanced stats
    const stats = {
      database: {
        totalPages: parseInt(dbStats.total_pages || 0),
        totalSizeRaw: formatSize(parseInt(dbStats.total_size_raw || 0)),
        currentFileSize: formatSize(currentFileSize),
        currentFileSizeBytes: currentFileSize,
        storageProgress: Math.min(storageProgress, 100),
        maxSizeBytes: maxSize,
        maxSize: formatSize(maxSize),
        lastModified: lastModified,
        lastCrawlDate: dbStats.last_crawl_date,
        topTopics: dbStats.topTopics || []
      },
      crawler: {
        isRunning: crawlerStats.isRunning || false,
        queueSize: crawlerStats.queueSize || 0,
        processedUrls: crawlerStats.processedUrls || parseInt(dbStats.total_pages || 0),
        crawlSpeed: crawlerStats.crawlSpeed || 0,
        totalRuntime: crawlerStats.totalRuntime || 0,
        successRate: crawlerStats.successRate || 100,
        lastProcessedUrl: crawlerStats.lastProcessedUrl || null
      },
      queue: dbStats.queue || { pending: 0, in_progress: 0, failed: 0 },
      system: {
        canDownload: fs.existsSync(dbPath),
        downloadRecommendation: currentFileSize > 100 * 1024 * 1024 ? 'streaming' : 'direct'
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Real-time stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    const dbExists = fs.existsSync(dbPath);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        exists: dbExists,
        size: dbExists ? fs.statSync(dbPath).size : 0
      },
      crawler: {
        running: crawlerStats.isRunning || false,
        queue_size: crawlerStats.queueSize || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get crawler status and stats
router.get('/crawler-stats', async (req, res) => {
  try {
    // Get database stats
    const dbStats = await getStats();
    
    // Check if database file exists and get its size
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
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

      currentCrawlerStats.processedUrls = parseInt(dbStats.processedUrls) || 0;
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