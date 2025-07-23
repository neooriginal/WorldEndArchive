const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Define the JSON file path
const JSON_FILE_PATH = path.join(DATA_DIR, 'worldend_archive.json');

// In-memory database representation
let database = {
  pages: [],
  page_topics: [],
  crawl_queue: [], // Keep in memory but don't save to file
  settings: {},
  metadata: {
    version: '2.0',
    created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    total_pages: 0,
    total_size: 0,
    schema: {
      page: {
        id: 'number',
        url: 'string',
        title: 'string',
        description: 'string',
        html_content: 'string',
        topics: 'string',
        date_archived: 'string'
      }
    }
  }
};

// Add more throttling mechanism for database saves
let lastSaveTime = 0;
const MIN_SAVE_INTERVAL = 30000; // 30 seconds between saves
let saveScheduled = false;
let dirtyFlag = false;

// Browser-friendly streaming constants
const CHUNK_SIZE = 1000; // Pages per chunk for browser processing
const MAX_BROWSER_CHUNK = 500; // Smaller chunks for browser-friendly output

/**
 * Create a streaming JSON reader for browser consumption
 * This allows browsers to process large JSON files in chunks
 */
function createBrowserFriendlyStream() {
  let pageIndex = 0;
  const totalPages = database.pages.length;
  
  return new Readable({
    objectMode: false,
    read() {
      try {
        if (pageIndex === 0) {
          // Start with metadata and opening structure
          this.push(JSON.stringify({
            metadata: database.metadata,
            total_pages: totalPages,
            chunk_size: MAX_BROWSER_CHUNK,
            chunks: Math.ceil(totalPages / MAX_BROWSER_CHUNK)
          }) + '\n---SEPARATOR---\n');
        }
        
        if (pageIndex < totalPages) {
          const chunkEnd = Math.min(pageIndex + MAX_BROWSER_CHUNK, totalPages);
          const chunk = database.pages.slice(pageIndex, chunkEnd);
          
          // Create browser-friendly chunk with topic data
          const browserChunk = {
            chunk_index: Math.floor(pageIndex / MAX_BROWSER_CHUNK),
            pages: chunk.map(page => {
              const pageTopics = database.page_topics
                .filter(pt => pt.page_id === page.id)
                .map(pt => pt.topic);
              
              return {
                id: page.id,
                url: page.url,
                title: page.title,
                description: extractDescription(page.html_content),
                html_content: page.html_content,
                topics: pageTopics.join(', '),
                date_archived: page.date_archived,
                content_size: page.content_size || page.html_content?.length || 0
              };
            })
          };
          
          this.push(JSON.stringify(browserChunk) + '\n---SEPARATOR---\n');
          pageIndex = chunkEnd;
        } else {
          // End of stream
          this.push(null);
        }
      } catch (error) {
        this.emit('error', error);
      }
    }
  });
}

/**
 * Extract a clean description from HTML content
 */
function extractDescription(htmlContent, maxLength = 200) {
  if (!htmlContent) return '';
  
  try {
    // Simple HTML stripping and text extraction
    const strippedText = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
      .replace(/<[^>]*>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    if (strippedText.length <= maxLength) {
      return strippedText;
    }
    
    // Find a good breaking point near the max length
    const truncated = strippedText.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    const lastPeriod = truncated.lastIndexOf('.');
    
    // Use the last sentence if possible, otherwise last word
    const breakPoint = lastPeriod > maxLength * 0.7 ? lastPeriod + 1 : 
                      lastSpace > maxLength * 0.7 ? lastSpace : maxLength;
    
    return strippedText.substring(0, breakPoint).trim() + (strippedText.length > breakPoint ? '...' : '');
  } catch (error) {
    return htmlContent.substring(0, maxLength) + '...';
  }
}

// Initialize the database
function initializeDatabase() {
  if (fs.existsSync(JSON_FILE_PATH)) {
    try {
      // Load from existing file - use faster synchronous read for startup
      const data = fs.readFileSync(JSON_FILE_PATH, 'utf8');
      const loadedData = JSON.parse(data);
      
      // Restore pages and settings
      database.pages = loadedData.pages || [];
      database.settings = loadedData.settings || {};
      
      // Create page_topics array if needed (for backward compatibility)
      if (loadedData.page_topics) {
        database.page_topics = loadedData.page_topics;
      } else {
        // Create an index for faster topic lookups
        database.page_topics = [];
        database.pages.forEach(page => {
          if (page.topics) {
            const topicsList = page.topics.split(',');
            topicsList.forEach(topic => {
              database.page_topics.push({
                page_id: page.id,
                topic: topic.trim(),
                confidence: 1.0
              });
            });
          }
        });
      }
      
      // Build URL index for faster lookups
      buildIndexes();
      
      // Always initialize crawl_queue as empty
      database.crawl_queue = [];
      
      console.log(`Database loaded with ${database.pages.length} pages and ${database.page_topics.length} topic entries`);
    } catch (error) {
      console.error('Error loading database from JSON file:', error);
      // Create a new database if loading fails
      initializeNewDatabase();
    }
  } else {
    // Create a new database if the file doesn't exist
    initializeNewDatabase();
  }
}

// Initialize a new database with default settings
function initializeNewDatabase() {
  database = {
    pages: [],
    page_topics: [],
    crawl_queue: [],
    settings: {
      'last_crawl_date': new Date(0).toISOString(),
      'total_pages': '0',
      'total_size_raw': '0'
    },
    metadata: {
      version: '2.0',
      created: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      total_pages: 0,
      total_size: 0,
      schema: {
        page: {
          id: 'number',
          url: 'string',
          title: 'string',
          description: 'string',
          html_content: 'string',
          topics: 'string',
          date_archived: 'string'
        }
      }
    }
  };
  
  // Create indexes for new database
  buildIndexes();
  
  saveDatabase();
  console.log('New database initialized');
}

// Build indexes for faster lookups
function buildIndexes() {
  // Create URL index for fast URL existence checks
  database.urlIndex = new Map();
  for (const page of database.pages) {
    if (page.url) {
      database.urlIndex.set(page.url, page.id);
    }
  }
  
  // Create hash index for deduplication
  database.hashIndex = new Map();
  for (const page of database.pages) {
    if (page.content_hash) {
      database.hashIndex.set(page.content_hash, page.id);
    }
  }
  
  console.log('Database indexes built');
}

// Save the database to the JSON file with throttling
function saveDatabase() {
  dirtyFlag = true;
  const currentTime = Date.now();
  
  // If it's been less than MIN_SAVE_INTERVAL since the last save, schedule a save for later
  if (currentTime - lastSaveTime < MIN_SAVE_INTERVAL) {
    if (!saveScheduled) {
      saveScheduled = true;
      const timeToWait = MIN_SAVE_INTERVAL - (currentTime - lastSaveTime);
      
      setTimeout(() => {
        saveScheduled = false;
        lastSaveTime = Date.now();
        // Only save if there are unsaved changes
        if (dirtyFlag) {
          performSave();
          dirtyFlag = false;
        }
      }, timeToWait);
    }
    return; // Skip this save, it will happen later
  }
  
  // Otherwise, save immediately
  lastSaveTime = currentTime;
  performSave();
  dirtyFlag = false;
}

// Actual save operation with optimized memory usage and browser-friendly format
function performSave() {
  try {
    console.log('Saving database to disk...');
    const startTime = Date.now();
    
    // Update metadata before saving
    database.metadata.last_updated = new Date().toISOString();
    database.metadata.total_pages = database.pages.length;
    database.metadata.total_size = database.pages.reduce((sum, p) => sum + (p.content_size || 0), 0);
    
    // Create a simplified version for storage with browser optimization
    const tempFile = JSON_FILE_PATH + '.tmp';
    const writeStream = fs.createWriteStream(tempFile);
    
    // Write browser-friendly JSON structure
    writeStream.write('{\n');
    writeStream.write('"metadata": ' + JSON.stringify(database.metadata, null, 2) + ',\n');
    writeStream.write('"pages": [\n');
    
    // Process pages in chunks to reduce memory usage
    const totalPages = database.pages.length;
    
    // Track if we need to add a comma
    let isFirst = true;
    
    // Page topics lookup map for faster access
    const pageTopicsMap = new Map();
    for (const topicEntry of database.page_topics) {
      if (!pageTopicsMap.has(topicEntry.page_id)) {
        pageTopicsMap.set(topicEntry.page_id, []);
      }
      pageTopicsMap.get(topicEntry.page_id).push(topicEntry.topic);
    }
    
    // Write pages in chunks with browser-friendly structure
    for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
      const chunk = database.pages.slice(i, i + CHUNK_SIZE);
      
      // Process this chunk of pages
      for (const page of chunk) {
        // For each page, get the associated topics from our map
        const pageTopics = pageTopicsMap.has(page.id) 
          ? pageTopicsMap.get(page.id).join(', ')
          : '';
          
        // Extract browser-friendly description
        const description = extractDescription(page.html_content);
        
        // Construct browser-optimized page JSON
        const pageJson = {
          id: page.id,
          url: page.url,
          title: page.title,
          description: description,
          html_content: page.html_content,
          topics: pageTopics,
          date_archived: page.date_archived,
          content_size: page.content_size || page.html_content?.length || 0
        };
        
        // Add comma if not the first item
        if (!isFirst) {
          writeStream.write(',\n');
        } else {
          isFirst = false;
        }
        
        // Write the page JSON with proper indentation for readability
        writeStream.write('  ' + JSON.stringify(pageJson));
      }
    }
    
    // Close the pages array and write settings
    writeStream.write('\n],\n');
    writeStream.write('"settings": ' + JSON.stringify(database.settings, null, 2) + '\n');
    writeStream.write('}');
    
    // Use promise to handle stream completion
    const streamFinished = new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    // End the stream and wait for it to finish
    writeStream.end();
    
    // After stream is finished, atomically rename the file
    streamFinished.then(() => {
      fs.renameSync(tempFile, JSON_FILE_PATH);
      const timeElapsed = Date.now() - startTime;
      console.log(`Database saved to disk in ${timeElapsed}ms (${database.pages.length} pages, ${formatBytes(database.metadata.total_size)})`);
    }).catch(error => {
      console.error('Error writing database file:', error);
    });
  } catch (error) {
    console.error('Error during database save:', error);
  }
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Batch insert multiple pages at once (more efficient than individual inserts)
async function batchInsertPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return false;
  }
  
  console.log(`Batch inserting ${pages.length} pages...`);
  const startTime = Date.now();
  
  try {
    // Get the next available ID
    let nextId = getNextId('pages');
    
    // Prepare arrays for batch operations
    const newPages = [];
    const newTopics = [];
    
    // Get the current total size
    const currentTotalSize = parseInt(database.settings.total_size_raw || '0', 10);
    let addedSize = 0;
    
    // Create a set of existing URLs for faster lookup
    const existingUrls = new Set(pages.filter(p => urlExists(p.url)).map(p => p.url));
    
    // Create a set of existing content hashes for deduplication
    const existingHashes = new Set();
    pages.forEach(page => {
      if (page.contentHash) {
        // Check if this hash exists in the database
        if (database.hashIndex && database.hashIndex.has(page.contentHash)) {
          existingHashes.add(page.contentHash);
        }
      }
    });
    
    // Process each page
    for (const page of pages) {
      // Skip if URL or content hash already exists
      if (existingUrls.has(page.url) || existingHashes.has(page.contentHash)) {
        continue;
      }
      
      // Create page entry
      const pageEntry = {
        id: nextId,
        url: page.url,
        title: page.title,
        html_content: page.content,
        content_hash: page.contentHash,
        date_archived: new Date().toISOString(),
        content_size: page.size
      };
      
      // Add page to batch
      newPages.push(pageEntry);
      
      // Process topics
      if (page.topics) {
        for (const [topic, score] of Object.entries(page.topics)) {
          newTopics.push({
            page_id: nextId,
            topic: topic,
            confidence: score
          });
        }
      }
      
      // Add to indexes
      if (database.urlIndex) {
        database.urlIndex.set(page.url, nextId);
      }
      if (database.hashIndex && page.contentHash) {
        database.hashIndex.set(page.contentHash, nextId);
      }
      
      // Add to existing sets to prevent duplicates within this batch
      existingUrls.add(page.url);
      if (page.contentHash) {
        existingHashes.add(page.contentHash);
      }
      
      // Update stats
      addedSize += page.size;
      
      // Increment ID for next page
      nextId++;
    }
    
    // Apply batch updates to database
    database.pages.push(...newPages);
    database.page_topics.push(...newTopics);
    
    // Update statistics
    database.settings.total_pages = (parseInt(database.settings.total_pages || '0', 10) + newPages.length).toString();
    database.settings.total_size_raw = (currentTotalSize + addedSize).toString();
    database.settings.last_crawl_date = new Date().toISOString();
    
    // Save database to file
    saveDatabase();
    
    const timeElapsed = Date.now() - startTime;
    console.log(`Batch insert completed: ${newPages.length} pages added in ${timeElapsed}ms`);
    
    return true;
  } catch (error) {
    console.error('Error in batch insert:', error);
    return false;
  }
}

// Get the next available ID for a collection
function getNextId(collection) {
  const ids = database[collection].map(item => item.id || 0);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// Check if a URL exists in the pages collection - use index for speed
function urlExists(url) {
  // Use URL index if available
  if (database.urlIndex) {
    return database.urlIndex.has(url);
  }
  // Fall back to array search
  return database.pages.some(page => page.url === url);
}

// Check if a URL exists in the crawl queue - use Map for faster lookups
let queueUrlSet = null;

// Check if a URL exists in the crawl queue
function queueExists(url) {
  // Initialize set on first use
  if (!queueUrlSet) {
    queueUrlSet = new Set(database.crawl_queue.map(item => item.url));
  }
  return queueUrlSet.has(url);
}

// Insert a page into the database with optimized performance
function insertPage(url, title, htmlContent, contentHash, contentSize, _, topics) {
  // Use URL index if available to check if page exists
  let existingId = database.urlIndex ? database.urlIndex.get(url) : null;
  let page = null;
  
  if (existingId) {
    // Find existing page with ID
    page = database.pages.find(p => p.id === existingId);
    
    if (page) {
      // Update existing page
      page.title = title;
      page.html_content = htmlContent;
      page.content_hash = contentHash;
      page.content_size = contentSize;
      page.last_checked = new Date().toISOString();
    }
  }
  
  if (!page) {
    // Create a new page with optimized ID generation
    const id = getNextId('pages');
    page = {
      id,
      url,
      title,
      html_content: htmlContent,
      content_hash: contentHash,
      content_size: contentSize,
      date_archived: new Date().toISOString(),
      last_checked: new Date().toISOString()
    };
    database.pages.push(page);
    
    // Update indexes
    if (database.urlIndex) {
      database.urlIndex.set(url, id);
    }
    if (database.hashIndex && contentHash) {
      database.hashIndex.set(contentHash, id);
    }
  }
  
  // Handle topics
  if (topics && Object.keys(topics).length) {
    // Remove existing topics for this page
    database.page_topics = database.page_topics.filter(pt => pt.page_id !== page.id);
    
    // Add new topics
    Object.entries(topics).forEach(([topic, confidence]) => {
      database.page_topics.push({
        page_id: page.id,
        topic,
        confidence
      });
    });
  }
  
  // Remove from queue if exists
  if (queueUrlSet && queueUrlSet.has(url)) {
    queueUrlSet.delete(url);
    database.crawl_queue = database.crawl_queue.filter(item => item.url !== url);
  }
  
  // Update statistics
  const totalPages = database.pages.length;
  const sizeStats = {
    raw: database.pages.reduce((sum, p) => sum + (p.content_size || 0), 0)
  };
  
  database.settings['total_pages'] = totalPages.toString();
  database.settings['total_size_raw'] = sizeStats.raw.toString();
  database.settings['last_crawl_date'] = new Date().toISOString();
  
  // Save changes to disk
  saveDatabase();
  
  return page.id;
}

// Add a URL to the crawl queue (in memory only)
function addToQueue(url, parentUrl, depth, priority = 0) {
  // Use our set for fast lookups
  if (!queueUrlSet) {
    queueUrlSet = new Set(database.crawl_queue.map(item => item.url));
  }
  
  // Skip if already in queue or already crawled
  if (queueUrlSet.has(url) || urlExists(url)) return false;
  
  // Add to queue
  database.crawl_queue.push({
    url,
    parent_url: parentUrl,
    depth,
    priority,
    status: 'pending',
    attempts: 0
  });
  
  // Update our index
  queueUrlSet.add(url);
  
  return true;
}

// Get the next batch of URLs from the queue with domain balancing
function getNextBatchFromQueue(batchSize, maxAttempts = 3) {
  // Create a map to track selected domains to limit URLs per domain in a batch
  const domainCounts = new Map();
  const maxPerDomain = 2; // Max URLs per domain in a single batch
  
  // Filter the queue for pending items with domain grouping
  const domains = new Map();
  
  for (const item of database.crawl_queue) {
    if (item.status === 'pending' && item.attempts < maxAttempts) {
      try {
        const domain = new URL(item.url).hostname;
        if (!domains.has(domain)) {
          domains.set(domain, []);
        }
        domains.get(domain).push(item);
      } catch (e) {
        // Handle invalid URLs in a separate group
        if (!domains.has('_invalid_')) {
          domains.set('_invalid_', []);
        }
        domains.get('_invalid_').push(item);
      }
    }
  }
  
  // Sort items within each domain by priority and depth
  for (const [domain, items] of domains) {
    domains.set(domain, items.sort((a, b) => {
      // Sort by priority (desc) then depth (asc)
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.depth - b.depth;
    }));
  }
  
  // Select items with domain balancing
  const selectedItems = [];
  let domainsWithItems = Array.from(domains.keys());
  
  // Round-robin selection from domains
  while (selectedItems.length < batchSize && domainsWithItems.length > 0) {
    // Start with a fresh set of domains for each round
    const currentDomains = [...domainsWithItems];
    let addedInRound = false;
    
    for (const domain of currentDomains) {
      const itemsForDomain = domains.get(domain);
      if (itemsForDomain.length === 0) {
        // Remove empty domains
        domains.delete(domain);
      } else {
        const domainCount = domainCounts.get(domain) || 0;
        if (domainCount < maxPerDomain) {
          // Take the top priority item from this domain
          const item = itemsForDomain.shift();
          selectedItems.push(item);
          domainCounts.set(domain, domainCount + 1);
          addedInRound = true;
          
          // Break if we've reached the batch size
          if (selectedItems.length >= batchSize) break;
        }
      }
    }
    
    // Update domains with items left
    domainsWithItems = Array.from(domains.keys()).filter(
      domain => domains.get(domain).length > 0
    );
    
    // If we didn't add any items in this round, break to avoid infinite loop
    if (!addedInRound) break;
  }
  
  // Return the selected items
  return selectedItems.slice(0, batchSize).map(item => ({
    url: item.url,
    parent_url: item.parent_url,
    depth: item.depth
  }));
}

// Mark URLs as in progress with batch support
function markUrlInProgress(urls) {
  // Make sure it can handle array or single url
  if (!Array.isArray(urls)) {
    urls = [urls];
  }
  
  // Use Set for faster lookups
  const urlSet = new Set(urls);
  
  for (let i = 0; i < database.crawl_queue.length; i++) {
    const item = database.crawl_queue[i];
    if (urlSet.has(item.url)) {
      item.status = 'in_progress';
      item.attempts += 1;
      item.last_attempt = new Date().toISOString();
    }
  }
}

// Mark a URL as failed
function markUrlFailed(url, error) {
  const item = database.crawl_queue.find(q => q.url === url);
  if (item) {
    item.status = 'failed';
    item.last_attempt = new Date().toISOString();
  }
  
  // No need to save as crawl_queue is only in memory
}

// Search pages based on query and topics
function searchPages(query, topics = [], limit = 100) {
  let results = database.pages;
  
  // Filter by topics if provided
  if (topics.length > 0) {
    results = results.filter(page => {
      const pageTopics = database.page_topics
        .filter(pt => pt.page_id === page.id)
        .map(pt => pt.topic);
      
      // Check if page has all specified topics
      return topics.every(topic => pageTopics.includes(topic));
    });
  }
  
  // Filter by query if provided
  if (query) {
    const queryLower = query.toLowerCase();
    results = results.filter(page => 
      (page.title && page.title.toLowerCase().includes(queryLower)) ||
      (page.url && page.url.toLowerCase().includes(queryLower))
    );
  }
  
  // Sort by date (newest first)
  results = results
    .sort((a, b) => new Date(b.date_archived) - new Date(a.date_archived))
    .slice(0, limit);
  
  // Format results to match the original SQLite format
  return results.map(page => {
    const pageTopics = database.page_topics
      .filter(pt => pt.page_id === page.id)
      .map(pt => pt.topic)
      .join(',');
    
    return {
      id: page.id,
      url: page.url,
      title: page.title,
      date_archived: page.date_archived,
      topics: pageTopics
    };
  });
}

// Get page content by ID
function getPageContent(id) {
  const page = database.pages.find(p => p.id === id);
  if (!page) return null;
  
  return {
    html_content: page.html_content,
    title: page.title,
    url: page.url
  };
}

// Get database stats
function getStats() {
  const stats = { ...database.settings };
  
  // Get topic distribution
  const topicCounts = {};
  database.page_topics.forEach(pt => {
    topicCounts[pt.topic] = (topicCounts[pt.topic] || 0) + 1;
  });
  
  stats.topTopics = Object.entries(topicCounts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Queue stats (in-memory only, not persisted)
  const queueStats = {
    pending: 0,
    in_progress: 0,
    failed: 0
  };
  
  database.crawl_queue.forEach(item => {
    if (queueStats[item.status] !== undefined) {
      queueStats[item.status]++;
    }
  });
  
  stats.queue = queueStats;
  
  return stats;
}

// Clean up the database
function vacuumDatabase() {
  // Clear the crawl queue (it's only in memory)
  database.crawl_queue = [];
  
  // Save the cleaned database
  saveDatabase();
}

// Save crawler statistics to the database
function saveCrawlerStats(stats) {
  try {
    // Update settings with new stats
    for (const [key, value] of Object.entries(stats)) {
      database.settings[key] = value.toString();
    }
    
    saveDatabase();
    return true;
  } catch (error) {
    console.error('Error saving crawler stats:', error);
    return false;
  }
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
  vacuumDatabase,
  saveCrawlerStats,
  batchInsertPages,
  createBrowserFriendlyStream, // Add the new function to exports
  database
}; 