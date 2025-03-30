const path = require('path');
const fs = require('fs');

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
  settings: {}
};

// Initialize the database
function initializeDatabase() {
  if (fs.existsSync(JSON_FILE_PATH)) {
    try {
      // Load from existing file
      const data = fs.readFileSync(JSON_FILE_PATH, 'utf8');
      const loadedData = JSON.parse(data);
      
      // Restore pages and settings
      database.pages = loadedData.pages || [];
      database.settings = loadedData.settings || {};
      
      // Create page_topics array if needed (for backward compatibility)
      if (loadedData.page_topics) {
        database.page_topics = loadedData.page_topics;
      } else {
        // Reconstruct topics from comma-separated lists if using new format
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
      
      // Always initialize crawl_queue as empty
      database.crawl_queue = [];
      
      console.log('Database loaded from JSON file');
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
    }
  };
  saveDatabase();
  console.log('New database initialized');
}

// Save the database to the JSON file
function saveDatabase() {
  try {
    // Create a simplified version for storage
    const storageData = {
      pages: database.pages.map(page => {
        // For each page, get the associated topics and create a comma-separated list
        const pageTopics = database.page_topics
          .filter(pt => pt.page_id === page.id)
          .map(pt => pt.topic)
          .join(', ');
          
        // Extract a description from the HTML content (first 200 chars of text)
        let description = '';
        if (page.html_content) {
          // Simple extraction of text from HTML
          description = page.html_content
            .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .trim()
            .substring(0, 200);        // First 200 chars
          
          if (description.length === 200) {
            description += '...';
          }
        }
        
        // Return only the essential fields
        return {
          id: page.id,
          url: page.url,
          title: page.title,
          description: description,
          html_content: page.html_content,
          topics: pageTopics,
          date_archived: page.date_archived
        };
      }),
      settings: database.settings
    };
    
    fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(storageData, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving database to JSON file:', error);
  }
}

// Get the next available ID for a collection
function getNextId(collection) {
  const ids = database[collection].map(item => item.id || 0);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

// Check if a URL exists in the pages collection
function urlExists(url) {
  return database.pages.some(page => page.url === url);
}

// Check if a URL exists in the crawl queue
function queueExists(url) {
  return database.crawl_queue.some(item => item.url === url);
}

// Insert a page into the database
function insertPage(url, title, htmlContent, contentHash, contentSize, _, topics) {
  let page = database.pages.find(p => p.url === url);
  
  if (page) {
    // Update existing page
    page.title = title;
    page.html_content = htmlContent; // Store as plain text HTML
    page.content_hash = contentHash;
    page.content_size = contentSize;
    page.last_checked = new Date().toISOString();
  } else {
    // Create a new page
    const id = getNextId('pages');
    page = {
      id,
      url,
      title,
      html_content: htmlContent, // Store as plain text HTML
      content_hash: contentHash,
      content_size: contentSize,
      date_archived: new Date().toISOString(),
      last_checked: new Date().toISOString()
    };
    database.pages.push(page);
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
  database.crawl_queue = database.crawl_queue.filter(item => item.url !== url);
  
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
  
  console.log(`Stored content for ${url} (${htmlContent ? htmlContent.length : 0} bytes)`);
  return page.id;
}

// Add a URL to the crawl queue (in memory only)
function addToQueue(url, parentUrl, depth, priority = 0) {
  if (queueExists(url) || urlExists(url)) return false;
  
  database.crawl_queue.push({
    url,
    parent_url: parentUrl,
    depth,
    priority,
    status: 'pending',
    attempts: 0
  });
  
  // No need to save the full database as we don't want to persist the queue
  return true;
}

// Get the next batch of URLs from the queue
function getNextBatchFromQueue(batchSize, maxAttempts = 3) {
  // Create a map to track selected domains to limit URLs per domain in a batch
  const domainCounts = new Map();
  const maxPerDomain = 2; // Max URLs per domain in a single batch
  
  // Sort and filter the queue first
  const sortedQueue = database.crawl_queue
    .filter(item => item.status === 'pending' && item.attempts < maxAttempts)
    .sort((a, b) => {
      // Sort by priority (desc) then depth (asc)
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.depth - b.depth;
    });

  // Select URLs while respecting domain limits
  const selectedItems = [];
  
  for (const item of sortedQueue) {
    if (selectedItems.length >= batchSize) break;
    
    try {
      const domain = new URL(item.url).hostname;
      const domainCount = domainCounts.get(domain) || 0;
      
      if (domainCount < maxPerDomain) {
        selectedItems.push(item);
        domainCounts.set(domain, domainCount + 1);
      }
    } catch (e) {
      // If URL is invalid, still include it (will be filtered out later)
      selectedItems.push(item);
    }
  }
  
  // Return the selected items
  return selectedItems.slice(0, batchSize).map(item => ({
    url: item.url,
    parent_url: item.parent_url,
    depth: item.depth
  }));
}

// Mark URLs as in progress
function markUrlInProgress(urls) {
  //make sure it can handle array or single url
  if (!Array.isArray(urls)) {
    urls = [urls];
  }
  
  urls.forEach(url => {
    const item = database.crawl_queue.find(q => q.url === url);
    if (item) {
      item.status = 'in_progress';
      item.attempts += 1;
      item.last_attempt = new Date().toISOString();
    }
  });
  
  // No need to save as crawl_queue is only in memory
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
  database
}; 