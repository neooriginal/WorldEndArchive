/**
 * WorldEndArchive - Knowledge Preservation System
 * Main Application Entry Point
 */

require('dotenv').config();
const { initializeDatabase, getStats, saveCrawlerStats } = require('./jsonDatabase');
const { startCrawler, getRecommendedSeeds, CONFIG, getQueueSize } = require('./crawler');
const api = require('./api');
const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');

// Configuration
const DEFAULT_PORT = process.env.PORT || 3000;
const MAX_DB_SIZE_BYTES = (parseInt(process.env.MAX_DB_SIZE_MB) || 8192) * 1024 * 1024; // Convert MB to bytes
const INFINITE_CRAWL = process.env.INFINITE_CRAWL === 'false';

// Crawler state
let crawlerRunning = false;
let crawlerInterval = null;
let crawlStartTime = null;
let totalRuntime = 0;
let pagesProcessed = 0;
let pagesFailed = 0;
let lastCrawlSpeed = 0;

// Create express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes - simplified to only provide database download
app.get('/api/download-db', (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    
    // Check if database exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    
    // Get file size
    const stats = fs.statSync(dbPath);
    const fileSizeInBytes = stats.size;
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=worldend_archive.json');
    res.setHeader('Content-Length', fileSizeInBytes);
    
    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(dbPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Database download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming database file' });
      }
    });
  } catch (error) {
    console.error('Database download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve the standalone app at the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'standalone', 'standalone.html'));
});

// Serve sql-wasm.js file
app.get('/sql-wasm.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'standalone', 'sql-wasm.js'));
});

// Serve the "Use standalone version" page for any other route
app.get('*', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>WorldEndArchive - Crawler Mode</title>
        <style>
          body {
            font-family: monospace;
            background-color: #0c0c0c;
            color: #33ff33;
            text-align: center;
            padding: 50px;
            line-height: 1.6;
          }
          h1 { color: #ff8c33; }
          a {
            color: #33ff33;
            text-decoration: none;
            border: 1px solid #33ff33;
            padding: 10px 20px;
            display: inline-block;
            margin-top: 20px;
            border-radius: 3px;
          }
          a:hover { background-color: rgba(51, 255, 51, 0.2); }
        </style>
      </head>
      <body>
        <h1>WorldEndArchive - Crawler Mode</h1>
        <p>This instance is in crawler-only mode.</p>
        <p>To search and browse the archive, please use the standalone version.</p>
        <a href="/">Go to Standalone Version</a>
        <p>Or download the database file to use with the offline standalone version:</p>
        <a href="/api/download-db">Download Database</a>
      </body>
    </html>
  `);
});

/**
 * Initialize the application
 */
async function init() {
  console.log('Initializing WorldEndArchive...');
  
  // Create data directory if it doesn't exist
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Initialize database
  initializeDatabase();
  
  // Start API server
  api.start(DEFAULT_PORT);
  
  console.log('WorldEndArchive initialized successfully');
  console.log(`Server running at http://localhost:${DEFAULT_PORT}`);
  
  // Start crawler automatically, continuing from where it left off
  await startAutomaticCrawler();
}

/**
 * Update crawler statistics
 */
function updateCrawlerStats(additionalStats = {}) {
  // Calculate current stats
  let runtime = 0;
  if (crawlStartTime) {
    runtime = Math.floor((Date.now() - crawlStartTime) / 1000);
  }
  
  // Calculate crawl speed (pages per minute)
  let crawlSpeed = 0;
  if (runtime > 0) {
    crawlSpeed = Math.round((pagesProcessed / (runtime / 60)) * 10) / 10;
  }
  
  // Success rate
  let successRate = 100;
  if (pagesProcessed + pagesFailed > 0) {
    successRate = Math.round((pagesProcessed / (pagesProcessed + pagesFailed)) * 100);
  }
  
  // Save crawl speed for when crawler is not running
  if (crawlSpeed > 0) {
    lastCrawlSpeed = crawlSpeed;
  }
  
  // Create stats object
  const stats = {
    isRunning: crawlerRunning,
    lastStartTime: crawlStartTime,
    processedUrls: pagesProcessed,
    failedUrls: pagesFailed,
    crawlSpeed: crawlerRunning ? crawlSpeed : lastCrawlSpeed,
    successRate: successRate,
    startTime: crawlStartTime,
    totalRuntime: totalRuntime + (crawlStartTime ? runtime : 0),
    ...additionalStats
  };

  // Save stats to database for persistence
  saveCrawlerStats({
    processed_pages: pagesProcessed.toString(),
    failed_pages: pagesFailed.toString(),
    total_runtime: (totalRuntime + (crawlStartTime ? runtime : 0)).toString(),
    last_crawl_date: new Date().toISOString()
  });
}

/**
 * Check if database size limit is reached
 * @returns {Promise<boolean>} True if limit is reached
 */
async function checkDatabaseSizeLimit() {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    if (!fs.existsSync(dbPath)) {
      return false;
    }
    
    const stats = fs.statSync(dbPath);
    return stats.size >= MAX_DB_SIZE_BYTES;
  } catch (error) {
    console.error('Error checking database size:', error);
    return false;
  }
}

/**
 * Start automatic crawler
 */
async function startAutomaticCrawler() {
  if (crawlerRunning) {
    console.log('Crawler is already running');
    return;
  }

  try {
    // Check if database size limit is reached
    const sizeLimitReached = await checkDatabaseSizeLimit();
    if (sizeLimitReached && !INFINITE_CRAWL) {
      console.log('Database size limit reached. Stopping crawler.');
      return;
    }

    crawlerRunning = true;
    crawlStartTime = Date.now();
    
    // Get recommended seed URLs
    const seedUrls = await getRecommendedSeeds();
    
    // Start crawler with seed URLs
    await startCrawler(seedUrls);
    
    // Set up interval to check crawler status
    crawlerInterval = setInterval(async () => {
      try {
        const queueSize = await getQueueSize();
        const sizeLimitReached = await checkDatabaseSizeLimit();
        
        // Stop crawler if size limit reached and not in infinite mode
        if (sizeLimitReached && !INFINITE_CRAWL) {
          console.log('Database size limit reached. Stopping crawler.');
          stopCrawler();
          return;
        }
        
        // Update crawler stats
        const stats = {
          isRunning: crawlerRunning,
          queueSize,
          processedUrls: pagesProcessed,
          failedUrls: pagesFailed,
          crawlSpeed: lastCrawlSpeed,
          totalRuntime: Math.floor((Date.now() - crawlStartTime) / 1000) + totalRuntime
        };
        
        await saveCrawlerStats(stats);
        api.updateCrawlerStats(stats);
        
      } catch (error) {
        console.error('Error updating crawler stats:', error);
      }
    }, 5000); // Update every 5 seconds
    
  } catch (error) {
    console.error('Error starting crawler:', error);
    crawlerRunning = false;
  }
}

/**
 * Stop crawler
 */
function stopCrawler() {
  if (!crawlerRunning) {
    return;
  }
  
  crawlerRunning = false;
  if (crawlerInterval) {
    clearInterval(crawlerInterval);
    crawlerInterval = null;
  }
  
  totalRuntime += Math.floor((Date.now() - crawlStartTime) / 1000);
  console.log('Crawler stopped');
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Command line interface for initiating crawls
 */
async function handleCommandLine() {
  const args = process.argv.slice(2);
  
  if (args.includes('--crawl')) {
    // If --crawl is specified, use explicit command-line crawling
    // (This overrides automatic crawling)
    
    if (crawlerInterval) {
      clearInterval(crawlerInterval);
      console.log('Automatic crawling stopped for manual mode');
    }
    
    let seedUrls;
    
    // Get seed URLs from arguments or use recommended seeds
    const seedIndex = args.indexOf('--crawl') + 1;
    if (seedIndex < args.length && !args[seedIndex].startsWith('--')) {
      // Use provided URLs
      seedUrls = args.slice(seedIndex).filter(arg => !arg.startsWith('--'));
    } else {
      // Use recommended seeds
      seedUrls = getRecommendedSeeds();
      console.log('Using recommended seed URLs');
    }
    
    if (seedUrls.length === 0) {
      console.error('Error: No seed URLs provided. Use: node index.js --crawl URL1 URL2 ...');
      process.exit(1);
    }
    
    console.log(`Starting crawl with ${seedUrls.length} seed URLs:`);
    seedUrls.slice(0, 5).forEach(url => console.log(`- ${url}`));
    if (seedUrls.length > 5) {
      console.log(`  ... and ${seedUrls.length - 5} more`);
    }
    
    // Reset counters for manual crawl
    pagesProcessed = 0;
    pagesFailed = 0;
    crawlStartTime = Date.now();
    crawlerRunning = true;
    updateCrawlerStats({ lastProcessedUrl: null, queueSize: seedUrls.length });
    
    // Track crawler events with callbacks
    const crawlerCallbacks = {
      onPageProcessed: (url, success) => {
        if (success) {
          pagesProcessed++;
        } else {
          pagesFailed++;
        }
        updateCrawlerStats({ lastProcessedUrl: url });
      },
      onQueueUpdate: (queueSize) => {
        updateCrawlerStats({ queueSize });
      }
    };
    
    startCrawler(seedUrls, crawlerCallbacks).catch(err => {
      console.error('Crawler error:', err);
      crawlerRunning = false;
      const runtime = Math.floor((Date.now() - crawlStartTime) / 1000);
      totalRuntime += runtime;
      crawlStartTime = null;
      updateCrawlerStats();
      process.exit(1);
    }).finally(() => {
      crawlerRunning = false;
      const runtime = Math.floor((Date.now() - crawlStartTime) / 1000);
      totalRuntime += runtime;
      crawlStartTime = null;
      updateCrawlerStats();
    });
  }
}

// Initialize the application and handle command line arguments
init()
  .then(() => handleCommandLine())
  .catch(err => {
    console.error('Initialization error:', err);
    process.exit(1);
  });

// Handle application shutdown
process.on('SIGINT', () => {
  console.log('Shutting down WorldEndArchive...');
  if (crawlerInterval) {
    clearInterval(crawlerInterval);
  }
  if (crawlStartTime) {
    const runtime = Math.floor((Date.now() - crawlStartTime) / 1000);
    totalRuntime += runtime;
  }
  process.exit(0);
}); 