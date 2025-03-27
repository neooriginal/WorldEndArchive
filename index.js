/**
 * WorldEndArchive - Knowledge Preservation System
 * Main Application Entry Point
 */

require('dotenv').config();
const { initializeDatabase, getStats } = require('./database');
const { startCrawler, getRecommendedSeeds, CONFIG } = require('./crawler');
const api = require('./api');
const path = require('path');
const fs = require('fs');

// Configuration
const DEFAULT_PORT = process.env.PORT || 3000;
const MAX_DB_SIZE_BYTES = 8 * 1024 * 1024 * 1024; // 8GB in bytes

// Crawler state
let crawlerRunning = false;
let crawlerInterval = null;

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
  
  // Start crawler automatically
  await startAutomaticCrawler();
}

/**
 * Start crawler automatically and keep running until size limit
 */
async function startAutomaticCrawler() {
  if (crawlerRunning) {
    console.log('Crawler is already running');
    return;
  }
  
  console.log('Starting automatic crawler...');
  
  // Get recommended seed URLs
  const seedUrls = getRecommendedSeeds();
  
  // Start initial crawl
  crawlerRunning = true;
  startCrawler(seedUrls).catch(err => {
    console.error('Crawler error:', err);
    crawlerRunning = false;
  }).finally(() => {
    crawlerRunning = false;
    console.log('Initial crawl completed');
  });
  
  // Set up periodic checks for database size and restart crawler if needed
  crawlerInterval = setInterval(async () => {
    // Skip if crawler is already running
    if (crawlerRunning) return;
    
    try {
      // Check database size
      const dbPath = path.join(__dirname, 'data', 'worldend_archive.db');
      const dbExists = fs.existsSync(dbPath);
      
      if (!dbExists) {
        console.log('Database file does not exist yet');
        return;
      }
      
      // Get file size
      const stats = fs.statSync(dbPath);
      const fileSizeInBytes = stats.size;
      
      // Check database statistics
      const dbStats = await getStats();
      const totalCompressedBytes = parseInt(dbStats.total_size_compressed || 0);
      const totalRawBytes = parseInt(dbStats.total_size_raw || 0);
      
      console.log(`Database file size: ${formatBytes(fileSizeInBytes)}`);
      console.log(`Total compressed content: ${formatBytes(totalCompressedBytes)}`);
      console.log(`Total raw content: ${formatBytes(totalRawBytes)}`);
      
      // Check if we've reached the size limit
      if (fileSizeInBytes >= MAX_DB_SIZE_BYTES) {
        console.log(`Database has reached the size limit of ${formatBytes(MAX_DB_SIZE_BYTES)}`);
        console.log('Automatic crawling stopped');
        clearInterval(crawlerInterval);
        return;
      }
      
      // Restart crawler with new seed URLs
      console.log('Restarting crawler...');
      crawlerRunning = true;
      
      startCrawler(seedUrls).catch(err => {
        console.error('Crawler error:', err);
      }).finally(() => {
        crawlerRunning = false;
        console.log('Crawler cycle completed');
      });
    } catch (error) {
      console.error('Error in crawler interval check:', error);
    }
  }, 1 * 60 * 1000); // Check every minute
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
    
    startCrawler(seedUrls).catch(err => {
      console.error('Crawler error:', err);
      process.exit(1);
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
  process.exit(0);
}); 