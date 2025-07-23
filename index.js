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
const MAX_DB_SIZE_BYTES = (parseInt(process.env.MAX_DB_SIZE_MB) || 10240) * 1024 * 1024; // Default to 10GB
const INFINITE_CRAWL = process.env.INFINITE_CRAWL !== 'false'; // Enable infinite crawl by default

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

// Serve the main interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route for crawler mode information
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
            margin: 10px;
            border-radius: 3px;
          }
          a:hover { background-color: rgba(51, 255, 51, 0.2); }
          .status { margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>WorldEndArchive - Knowledge Preservation System</h1>
        <div class="status">
          <p>🤖 Crawler Mode Active - Archiving Knowledge for Posterity</p>
          <p>Current database: <strong>${formatBytes(getDatabaseSize())}</strong> / 10GB</p>
        </div>
        <p>This system continuously crawls and archives important knowledge from the web.</p>
        <a href="/">View Status Dashboard</a>
        <a href="/api/download-db">Download Archive Database</a>
        <p><small>The standalone reader is available in the downloaded archive.</small></p>
      </body>
    </html>
  `);
});

/**
 * Get current database file size
 */
function getDatabaseSize() {
  try {
    const dbPath = path.join(__dirname, 'data', 'worldend_archive.json');
    if (fs.existsSync(dbPath)) {
      return fs.statSync(dbPath).size;
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

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
    const currentSize = stats.size;
    const limitReached = currentSize >= MAX_DB_SIZE_BYTES;
    
    if (limitReached) {
      console.log(`Database size limit reached: ${formatBytes(currentSize)} / ${formatBytes(MAX_DB_SIZE_BYTES)}`);
    } else {
      const remaining = MAX_DB_SIZE_BYTES - currentSize;
      console.log(`Database size: ${formatBytes(currentSize)} / ${formatBytes(MAX_DB_SIZE_BYTES)} (${formatBytes(remaining)} remaining)`);
    }
    
    return limitReached;
  } catch (error) {
    console.error('Error checking database size:', error);
    return false;
  }
}

/**
 * Start automatic crawler with improved continuous operation
 */
async function startAutomaticCrawler() {
  if (crawlerRunning) {
    console.log('Crawler is already running');
    return;
  }

  try {
    // Check if database size limit is reached
    const sizeLimitReached = await checkDatabaseSizeLimit();
    if (sizeLimitReached) {
      console.log('Database size limit reached. Crawler will not start.');
      return;
    }

    crawlerRunning = true;
    crawlStartTime = Date.now();
    
    console.log('Starting automatic crawler...');
    console.log(`Maximum database size: ${formatBytes(MAX_DB_SIZE_BYTES)}`);
    
    // Get recommended seed URLs
    const seedUrls = await getRecommendedSeeds();
    
    // Start crawler with seed URLs
    await startCrawler(seedUrls);
    
    // Set up interval to check crawler status and manage continuous operation
    crawlerInterval = setInterval(async () => {
      try {
        const queueSize = await getQueueSize();
        const sizeLimitReached = await checkDatabaseSizeLimit();
        
        // Update crawler stats
        const runtime = crawlStartTime ? Math.floor((Date.now() - crawlStartTime) / 1000) : 0;
        const stats = {
          isRunning: crawlerRunning,
          queueSize,
          processedUrls: pagesProcessed,
          failedUrls: pagesFailed,
          crawlSpeed: lastCrawlSpeed,
          totalRuntime: runtime + totalRuntime,
          sizeLimitReached
        };
        
        await saveCrawlerStats(stats);
        api.updateCrawlerStats(stats);
        
        // Stop crawler if size limit reached
        if (sizeLimitReached) {
          console.log('Database size limit reached. Stopping crawler gracefully...');
          stopCrawler();
          return;
        }
        
        // Restart crawler if queue is empty but we haven't reached size limit
        if (queueSize === 0 && crawlerRunning) {
          console.log('Queue is empty but size limit not reached. Adding more seed URLs...');
          const additionalSeeds = await getRecommendedSeeds();
          // Re-add original seeds to continue crawling
          for (const url of additionalSeeds.slice(0, 10)) {
            await addToQueue(url, null, 0, 10);
          }
        }
        
      } catch (error) {
        console.error('Error in crawler monitoring interval:', error);
      }
    }, 10000); // Check every 10 seconds
    
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