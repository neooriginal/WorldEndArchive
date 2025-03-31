const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const robots = require('robots-parser');
const { URL } = require('url');
const crypto = require('crypto');
const { parse } = require('node-html-parser');
const { 
  insertPage, 
  addToQueue, 
  getNextBatchFromQueue, 
  markUrlInProgress,
  markUrlFailed,
  urlExists,
  queueExists,
  database,  // Import the database object for direct access
  batchInsertPages  // Add this import
} = require('./jsonDatabase');
const { classifyContent } = require('./classifier');

// Configuration settings
const CONFIG = {
  // Crawling parameters
  maxDepth: 3,                    // Maximum depth to crawl
  concurrentRequests: 10,         // Number of concurrent requests
  maxConcurrentRequestsPerDomain: 2, // Limit requests per domain
  requestTimeout: 15000,          // Increased timeout to 15 seconds (was 1000)
  requestDelay: 300,              // Decreased delay between batches (was 500)
  respectRobotsTxt: true,         // Whether to respect robots.txt
  
  // In-memory page buffer settings
  pageBufferSize: 100,           // Number of pages to buffer before saving to database
  
  humanuserAgents: [
    // Chrome
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Mobile Safari/537.36",
  
    // Firefox
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Android 12; Mobile; rv:115.0) Gecko/115.0 Firefox/115.0",
  
    // Safari
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  
    // Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Safari/537.36 Edg/112.0.1722.48",
    
    // Opera
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.137 Safari/537.36 OPR/98.0",
  
    // Older Devices/Browsers
    "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0)",
  ],
  
  // Content filtering
  minTopicMatchScore: 2,          // Minimum score to consider a topic match
  minTopicsRequired: 1,           // Minimum number of topics required to archive content
  minContentLength: 500,          // Minimum content length in characters
  
  // Topic importance weights (higher = more important)
  topicWeights: {
    'science': 2.0,
    'technology': 2.0,
    'medicine': 2.0,
    'engineering': 2.0,
    'agriculture': 2.0,
    'mathematics': 1.8,
    'history': 1.5,
    'literature': 1.5,
    'education': 1.8,
    'survival': 2.5,
    'computing': 1.8,
    'entertainment': 0.6  // Lower priority for entertainment content
  },
  
  // Filters
  allowedDomains: [],           // Empty means all domains, specific items restrict to those domains
  excludedDomains: [           // Domains to explicitly exclude  
    'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com',
    'youtube.com', 'linkedin.com', 'reddit.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'walmart.com', 'target.com', 'etsy.com',
    // Additional entertainment-focused sites
    'netflix.com', 'hulu.com', 'disneyplus.com', 'hbomax.com',
    'peacocktv.com', 'primevideo.com', 'twitch.tv', 'ign.com',
    'gamespot.com', 'polygon.com', 'kotaku.com', 'tmz.com',
    'eonline.com', 'variety.com', 'hollywoodreporter.com', 'buzzfeed.com'
  ],
  excludedExtensions: [        // File extensions to skip
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.mp3', '.mp4', '.avi',
    '.mov', '.wmv', '.flv', '.jpg', '.jpeg', '.png', '.gif', '.bmp',
    '.tiff', '.svg', '.webp', '.ico', '.css', '.js', '.json', '.xml'
  ],
  allowedPrefix: ['http://', 'https://'],
  
  // Max size to store (50MB)
  maxPageSize: 50 * 1024 * 1024,
  
  // Data directory
  dataDir: path.join(__dirname, 'data'),

  // New configuration parameters
  maxPagesPerDomain: 50,
  allowedContentTypes: [
    'text/html',
    'application/xhtml+xml',
    'text/plain'
  ]
};

// Store robots.txt data
const robotsTxtCache = new Map();

// Create in-memory page buffer for batch database operations
const pageBuffer = [];

/**
 * Buffer a page for batch database insert
 * @param {string} url - Page URL
 * @param {string} title - Page title
 * @param {string} content - Page HTML content
 * @param {string} contentHash - Hash for deduplication
 * @param {number} size - Content size in bytes
 * @param {Object} topics - Classified topics
 */
async function bufferPage(url, title, content, contentHash, size, topics) {
  pageBuffer.push({
    url,
    title,
    content,
    contentHash,
    size,
    topics
  });
  
  // If buffer reached threshold, save to database
  if (pageBuffer.length >= CONFIG.pageBufferSize) {
    await savePageBuffer();
  }
}

/**
 * Save all pages in buffer to database
 */
async function savePageBuffer() {
  if (pageBuffer.length === 0) return;
  
  console.log(`Saving batch of ${pageBuffer.length} pages to database...`);
  
  try {
    // If batchInsertPages is available, use it
    if (typeof batchInsertPages === 'function') {
      await batchInsertPages(pageBuffer);
    } else {
      // Otherwise, insert pages one by one
      for (const page of pageBuffer) {
        await insertPage(
          page.url,
          page.title,
          page.content,
          page.contentHash,
          page.size,
          page.topics
        );
      }
    }
    
    // Clear the buffer
    pageBuffer.length = 0;
    console.log('Batch save completed successfully');
  } catch (error) {
    console.error('Error saving page buffer:', error);
    
    // In case of error, try to save individually
    if (typeof batchInsertPages === 'function') {
      console.log('Trying to save pages individually...');
      for (let i = 0; i < pageBuffer.length; i++) {
        try {
          const page = pageBuffer[i];
          await insertPage(
            page.url,
            page.title,
            page.content,
            page.contentHash,
            page.size,
            page.topics
          );
          
          // Remove saved page from buffer
          pageBuffer.splice(i, 1);
          i--;
        } catch (e) {
          console.error(`Error saving individual page (${i}):`, e.message);
        }
      }
    }
  }
}

/**
 * Initialize crawler data directory
 */
function initCrawler() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  }
}

/**
 * Extract domain from URL
 * @param {string} url - The URL to extract domain from
 * @returns {string} The domain
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
  } catch (e) {
    return null;
  }
}

/**
 * Check if URL should be crawled based on domain and extension rules
 * @param {string} url - URL to check
 * @returns {boolean} Whether URL should be crawled
 */
function shouldCrawlUrl(url) {
  try {
    const parsedUrl = new URL(url);
    
    // Check protocol
    if (!CONFIG.allowedPrefix.some(prefix => url.startsWith(prefix))) {
      return false;
    }
    
    // Extract domain
    const domain = extractDomain(url);
    
    // Check domain rules
    if (CONFIG.excludedDomains.some(excluded => domain.includes(excluded))) {
      return false;
    }
    
    if (CONFIG.allowedDomains.length > 0 && 
        !CONFIG.allowedDomains.some(allowed => domain.includes(allowed))) {
      return false;
    }
    
    // Check file extension
    const pathLower = parsedUrl.pathname.toLowerCase();
    if (CONFIG.excludedExtensions.some(ext => pathLower.endsWith(ext))) {
      return false;
    }
    
    // Skip URLs with fragments or complex query strings (usually not worth archiving)
    if (parsedUrl.hash || parsedUrl.search.length > 100) {
      return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if URL is allowed by robots.txt
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} Whether URL is allowed
 */
async function isAllowedByRobotsTxt(url) {
  if (!CONFIG.respectRobotsTxt) {
    return true;
  }
  
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.origin;
    
    // Check cache first
    if (!robotsTxtCache.has(domain)) {
      // Fetch robots.txt
      try {
        const robotsUrl = `${domain}/robots.txt`;
        const response = await axios.get(robotsUrl, { 
          timeout: CONFIG.requestTimeout,
          headers: {
            'User-Agent': CONFIG.humanuserAgents[Math.floor(Math.random() * CONFIG.humanuserAgents.length)]
          }
        });
        
        // Simple robots.txt parsing
        const lines = response.data.split('\n');
        const rules = { 
          allow: [], 
          disallow: [] 
        };
        
        let activeAgent = '*';
        let inRelevantAgent = true;
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          // Skip comments and empty lines
          if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
          }
          
          // Check for User-agent lines
          if (trimmed.toLowerCase().startsWith('user-agent:')) {
            const agent = trimmed.split(':')[1].trim();
            activeAgent = agent;
            inRelevantAgent = (agent === '*' || CONFIG.humanuserAgents.includes(agent));
            continue;
          }
          
          // Only process rules for relevant user agent
          if (!inRelevantAgent) {
            continue;
          }
          
          // Process allow rules
          if (trimmed.toLowerCase().startsWith('allow:')) {
            const path = trimmed.split(':')[1].trim();
            rules.allow.push(path);
          }
          
          // Process disallow rules
          if (trimmed.toLowerCase().startsWith('disallow:')) {
            const path = trimmed.split(':')[1].trim();
            if (path) {  // Empty disallow means allow all
              rules.disallow.push(path);
            }
          }
        }
        
        robotsTxtCache.set(domain, rules);
      } catch (e) {
        // If can't fetch robots.txt, assume everything is allowed
        robotsTxtCache.set(domain, { allow: [], disallow: [] });
      }
    }
    
    // Check against rules
    const rules = robotsTxtCache.get(domain);
    const path = parsedUrl.pathname;
    
    // Check allow rules (they take precedence)
    for (const allowPath of rules.allow) {
      if (path.startsWith(allowPath)) {
        return true;
      }
    }
    
    // Check disallow rules
    for (const disallowPath of rules.disallow) {
      if (path.startsWith(disallowPath)) {
        return false;
      }
    }
    
    // If no rule matches, it's allowed
    return true;
  } catch (e) {
    // If any error occurs, default to allowing the URL
    return true;
  }
}

/**
 * Calculate a priority score for a URL to optimize crawling important content first
 * @param {string} url - URL to analyze
 * @param {number} depth - Crawl depth
 * @returns {number} - Priority score (higher = more important)
 */
function calculateUrlPriority(url, depth) {
  try {
    // Base priority inversely proportional to depth
    let priority = 10 - depth * 2;
    
    // Parse the URL
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname.toLowerCase();
    const path = parsedUrl.pathname.toLowerCase();
    
    // Prioritize educational and scientific domains
    if (domain.endsWith('.edu') || domain.endsWith('.gov') || domain.endsWith('.org')) {
      priority += 3;
    }
    
    // Prioritize domains that are more likely to contain valuable information
    const highValueDomains = [
      'wikipedia.org', 'wikibooks.org', 'wikihow.com',
      'github.com', 'stackoverflow.com', 'stackexchange.com',
      'archive.org', 'gutenberg.org', 'academia.edu',
      'researchgate.net', 'ncbi.nlm.nih.gov', 'arxiv.org',
      'scholar.google.com', 'sciencedirect.com', 'ieee.org',
      'acm.org', 'nih.gov', 'cdc.gov', 'who.int',
      'mit.edu', 'stanford.edu', 'harvard.edu',
      'berkeley.edu', 'cambridge.org', 'oxford.ac.uk'
    ];
    
    if (highValueDomains.some(d => domain.includes(d))) {
      priority += 4;
    }
    
    // Deprioritize social media, news, and entertainment domains
    const lowValueDomains = [
      'instagram.', 'facebook.', 'twitter.', 'tiktok.',
      'pinterest.', 'tumblr.', 'reddit.', 'youtube.',
      'dailymail.', 'buzzfeed.', 'cnn.', 'foxnews.',
      'nytimes.', 'wsj.', 'telegraph.', 'guardian.'
    ];
    
    if (lowValueDomains.some(d => domain.includes(d))) {
      priority -= 5;
    }
    
    // Prioritize paths that indicate educational or valuable content
    const highValuePaths = [
      '/wiki/', '/article/', '/science/', '/research/',
      '/education/', '/learn/', '/tutorial/', '/guide/',
      '/howto/', '/encyclopedia/', '/reference/',
      '/health/', '/medicine/', '/technology/', '/engineering/'
    ];
    
    if (highValuePaths.some(p => path.includes(p))) {
      priority += 2;
    }
    
    // Deprioritize paths that suggest less valuable content
    const lowValuePaths = [
      '/tag/', '/category/', '/author/', '/profile/',
      '/comment/', '/forum/', '/discussion/', '/blog/',
      '/news/', '/gossip/', '/celebrity/', '/entertainment/'
    ];
    
    if (lowValuePaths.some(p => path.includes(p))) {
      priority -= 2;
    }
    
    // Ensure priority is within reasonable bounds
    return Math.max(1, Math.min(10, priority));
  } catch (e) {
    // Default priority if there's an error
    return 5;
  }
}

/**
 * Crawl a single page
 * @param {string} url - URL to crawl
 * @param {string} parentUrl - Parent URL that linked to this one
 * @param {number} depth - Current crawl depth
 */
async function crawlPage(url, parentUrl, depth) {
  console.log(`Crawling: ${url} (depth: ${depth})`);
  
  try {
    // Check if allowed by robots.txt
    if (!await isAllowedByRobotsTxt(url)) {
      console.log(`Skipping (robots.txt): ${url}`);
      markUrlFailed(url, "Blocked by robots.txt");
      return;
    }
    
    // Get domain for rate limiting
    const domain = extractDomain(url);
    if (!domain) {
      console.log(`Skipping (invalid URL): ${url}`);
      markUrlFailed(url, "Invalid URL");
      return;
    }
    
    // Apply rate limiting
    await getDomainLock(domain);
    
    // Process the crawl
    return processCrawl(url, parentUrl, depth).finally(() => {
      // Release the domain lock
      releaseDomainLock(domain);
    });
  } catch (error) {
    console.error(`Error in crawlPage for ${url}:`, error.message);
    markUrlFailed(url, error.message);
  }
}

// Simple concurrency control per domain
const domainLocks = new Map();
const domainCounts = new Map();

/**
 * Get a lock for a domain
 * @param {string} domain - The domain to get a lock for
 * @returns {Promise<void>} - Resolves when the lock is acquired
 */
async function getDomainLock(domain) {
  // Initialize the domain count if it doesn't exist
  if (!domainCounts.has(domain)) {
    domainCounts.set(domain, 0);
  }
  
  // Wait until we can acquire a lock
  while (domainCounts.get(domain) >= CONFIG.maxConcurrentRequestsPerDomain) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Increment the count for this domain
  domainCounts.set(domain, domainCounts.get(domain) + 1);
}

/**
 * Release a lock for a domain
 * @param {string} domain - The domain to release the lock for
 */
function releaseDomainLock(domain) {
  if (domainCounts.has(domain)) {
    const count = domainCounts.get(domain);
    if (count > 0) {
      domainCounts.set(domain, count - 1);
    }
  }
}

/**
 * Process the actual crawling after rate limiting
 * @param {string} url - URL to crawl
 * @param {string} parentUrl - Parent URL that linked to this one
 * @param {number} depth - Current crawl depth
 */
async function processCrawl(url, parentUrl, depth) {
  // Fetch page with retry logic
  let response;
  let retries = 3;
  
  while (retries > 0) {
    try {
      response = await axios.get(url, {
        timeout: CONFIG.requestTimeout,
        maxContentLength: CONFIG.maxPageSize,
        headers: {
          'User-Agent': CONFIG.humanuserAgents[Math.floor(Math.random() * CONFIG.humanuserAgents.length)],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        responseType: 'arraybuffer',  // Use arraybuffer to handle binary content
        validateStatus: status => status < 500 // Accept all status codes below 500 to handle them ourselves
      });
      break; // Success, exit retry loop
    } catch (e) {
      retries--;
      if (retries === 0) {
        throw e; // Re-throw if all retries failed
      }
      console.log(`Retry ${3-retries}/3 for ${url} after error: ${e.message}`);
      // Add exponential backoff between retries
      const waitTime = 1000 * Math.pow(2, 3-retries);
      console.log(`Waiting ${waitTime}ms before next retry`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // Handle HTTP error codes, but only mark 403, 401, 410 as permanently failed
  if (response.status !== 200) {
    const errorMessage = `HTTP error: ${response.status}`;
    console.log(`Skipping (${errorMessage}): ${url}`);
    
    // Only mark permanent errors as failed, others could be temporary
    if ([401, 403, 410].includes(response.status)) {
      markUrlFailed(url, errorMessage);
    } else {
      // For other errors (like 429, 500, etc), we'll add back to queue with a delay if depth allows
      if (depth < CONFIG.maxDepth) {
        console.log(`Re-queuing ${url} for later retry due to temporary error`);
        await addToQueue(url, parentUrl, depth, 1); // Lower priority for retry
      }
    }
    return;
  }
  
  // Determine content type
  const contentType = response.headers['content-type'] || '';
  
  // Skip non-HTML content
  if (!CONFIG.allowedContentTypes.some(type => contentType.includes(type))) {
    console.log(`Skipping (unsupported content type ${contentType}): ${url}`);
    markUrlFailed(url, `Unsupported content type: ${contentType}`);
    return;
  }
  
  // Convert to utf-8 string for processing
  const contentBuffer = Buffer.from(response.data);
  let htmlContent;
  
  try {
    // Try to decode as UTF-8 first
    htmlContent = contentBuffer.toString('utf8');
  } catch (e) {
    // Fall back to latin1 if UTF-8 fails
    htmlContent = contentBuffer.toString('latin1');
  }
  
  // Use a single cheerio instance for all operations to avoid multiple parsing
  const $ = cheerio.load(htmlContent);
  
  // Extract title and body text in one pass
  const title = $('title').text().trim() || url;
  
  // Extract text content using a more optimized approach
  // Only extract text from common content elements
  const bodyText = $('body').find('p, h1, h2, h3, h4, h5, h6, article, section, main, div.content, div.main').text();
  
  // Skip pages with extremely short content, but extract links regardless
  const isContentTooShort = bodyText.length < CONFIG.minContentLength;
  
  // Extract links regardless of content length if we haven't reached max depth
  let newLinks = 0;
  
  if (depth < CONFIG.maxDepth) {
    // More efficient link extraction
    const links = new Set(); // Use a Set to avoid duplicate URLs
    
    // Find all links
    $('a[href]').each((_, link) => {
      const href = $(link).attr('href');
      if (href) {
        try {
          // Convert to absolute URL
          const absoluteUrl = new URL(href, url).toString();
          
          // Check if URL should be crawled
          if (shouldCrawlUrl(absoluteUrl)) {
            links.add(absoluteUrl);
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    });
    
    // Add unique links to queue
    const linkPromises = [];
    for (const link of links) {
      const priority = calculateUrlPriority(link, depth + 1);
      linkPromises.push(addToQueue(link, url, depth + 1, priority));
    }
    
    // Process all links in parallel
    const results = await Promise.all(linkPromises);
    newLinks = results.filter(result => result).length;
    
    console.log(`Found ${links.size} links, added ${newLinks} new ones to queue`);
  }
  
  // Skip archiving if content is too short, but we've already added the links
  if (isContentTooShort) {
    console.log(`Skipping (content too short): ${url}`);
    return;
  }
  
  // Classify content
  const topics = classifyContent(
    title, 
    bodyText,
    CONFIG.minTopicMatchScore,
    CONFIG.topicWeights
  );
  
  // Check if any topics matched with good confidence
  const topicCount = Object.keys(topics).length;
  if (topicCount < CONFIG.minTopicsRequired) {
    console.log(`Skipping (no relevant topics found): ${url}`);
    return;
  }
  
  console.log(`Content classified into ${topicCount} topics: ${Object.keys(topics).join(', ')}`);
  
  // Store the content as plain text HTML
  try {
    // Create hash for deduplication
    const contentHash = crypto.createHash('sha256').update(htmlContent).digest('hex');
    
    // Buffer the content for batch database insert
    await bufferPage(
      url,
      title,
      htmlContent,
      contentHash,
      htmlContent.length,
      topics
    );
    
    console.log(`Successfully buffered ${htmlContent.length} bytes for: ${url}`);
  } catch (storageError) {
    console.error(`Error buffering content for ${url}: ${storageError.message}`);
    throw storageError;
  }
  
  console.log(`Successfully buffered: ${url}`);
}

/**
 * Get additional seed URLs beyond the recommended ones
 * This function provides fallback URLs if the crawler runs out of URLs to crawl
 */
function getAdditionalSeeds() {
  return [
    // Academic and Educational
    'https://www.khanacademy.org/',
    'https://ocw.mit.edu/',
    'https://www.coursera.org/',
    'https://www.edx.org/',
    
    // Government Resources
    'https://www.usa.gov/',
    'https://www.loc.gov/',
    'https://www.archives.gov/',
    'https://www.epa.gov/',
    'https://www.energy.gov/',
    
    // Technical Documentation
    'https://docs.python.org/',
    'https://docs.oracle.com/en/java/',
    'https://developer.apple.com/documentation/',
    'https://docs.microsoft.com/',
    
    // Science and Research (Additional)
    'https://www.nasa.gov/',
    'https://www.nsf.gov/',
    'https://www.noaa.gov/',
    'https://www.pnas.org/',
    
    // Open Source Knowledge
    'https://openstax.org/',
    'https://www.openculture.com/',
    'https://wikieducator.org/',
    
    // DIY and Practical Skills
    'https://www.instructables.com/',
    'https://www.popularmechanics.com/',
    'https://www.popularsciencearchive.com/',
    
    // Health and Medicine
    'https://health.gov/',
    'https://www.aafp.org/',
    'https://medlineplus.gov/',
    
    // Agriculture and Gardening
    'https://www.nal.usda.gov/',
    'https://garden.org/',
    'https://extension.psu.edu/',
    
    // Mathematics and Statistics
    'https://brilliant.org/',
    'https://stats.stackexchange.com/',
    'https://www.ams.org/'
  ];
}

/**
 * Start crawler with seed URLs
 * @param {Array<string>} seedUrls - Initial URLs to crawl
 * @param {Object} callbacks - Optional callbacks for tracking progress
 */
async function startCrawler(seedUrls, callbacks = {}) {
  console.log('Starting crawler');
  
  // Set up callbacks
  const onPageProcessed = callbacks.onPageProcessed || (() => {});
  const onQueueUpdate = callbacks.onQueueUpdate || (() => {});
  
  // Initialize data directory
  initCrawler();
  
  // Store original seeds for reloading
  const originalSeeds = [...seedUrls];
  
  // Get backup seeds for when we exhaust the original ones
  const additionalSeeds = getAdditionalSeeds();
  let additionalSeedsUsed = false;
  
  // Add seed URLs to queue with depth 0 and high priority
  const seedCount = await addSeedUrlsToQueue(seedUrls);
  if (seedCount === 0) {
    console.error("ERROR: No valid seed URLs were added to the queue. Crawler cannot start.");
    return;
  }
  
  console.log(`Successfully added ${seedCount} seed URLs to queue. Starting crawler...`);
  
  // Process URLs in batches until explicitly stopped
  let running = true;
  let emptyBatchCount = 0;
  let processed = 0;
  let startTime = Date.now();
  
  while (running) {
    // Get queue size for reporting
    try {
      const queueSize = await getQueueSize();
      onQueueUpdate(queueSize);
      
      // Calculate and log crawl rate
      const elapsedMinutes = (Date.now() - startTime) / 60000;
      if (elapsedMinutes >= 1) {
        const rate = processed / elapsedMinutes;
        console.log(`Crawl rate: ${rate.toFixed(2)} pages/minute (${processed} pages in ${elapsedMinutes.toFixed(2)} minutes)`);
      }
      
      // If queue is nearly empty, reload seed URLs
      if (queueSize < 5) {
        if (emptyBatchCount > 5 && !additionalSeedsUsed) {
          console.log("Queue is nearly empty. Adding additional seed URLs to continue crawling...");
          await addSeedUrlsToQueue(additionalSeeds);
          additionalSeedsUsed = true;
          emptyBatchCount = 0;
        } else if (emptyBatchCount > 10) {
          console.log("Queue is nearly empty. Reloading original seed URLs to continue crawling...");
          await addSeedUrlsToQueue(originalSeeds);
          emptyBatchCount = 0;
        }
      }
    } catch (error) {
      console.error('Error getting queue size:', error);
    }
    
    const batchProcessed = await processBatch(CONFIG.concurrentRequests, (url, success) => {
      if (success) processed++;
      onPageProcessed(url, success);
    });
    
    if (!batchProcessed) {
      emptyBatchCount++;
      console.log(`No URLs processed in this batch. Empty batch count: ${emptyBatchCount}`);
      
      // Wait longer between empty batches to allow for database updates
      await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay * 3));
    } else {
      emptyBatchCount = 0;
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
  }
  
  // Save any remaining pages in the buffer before exiting
  if (pageBuffer.length > 0) {
    console.log(`Saving remaining ${pageBuffer.length} pages before exiting...`);
    await savePageBuffer();
  }
  
  console.log('Crawler finished');
}

/**
 * Helper function to add seed URLs to the queue
 */
async function addSeedUrlsToQueue(seedUrls) {
  console.log(`Adding ${seedUrls.length} seed URLs to queue...`);
  let added = 0;
  
  for (const url of seedUrls) {
    if (url && typeof url === 'string') {
      try {
        // Validate and clean the URL
        const cleanedUrl = url.trim().replace(/^\s+https:/i, 'https:').replace(/^https:(?!\/\/)/, 'https://');
        
        // Validate URL format
        new URL(cleanedUrl); // Will throw if invalid
        
        // Add to queue with high priority
        const success = await addToQueue(cleanedUrl, null, 0, 10);  // Priority 10 for seed URLs
        if (success) added++;
      } catch (e) {
        console.error(`Invalid seed URL: ${url} - ${e.message}`);
      }
    }
  }
  
  console.log(`Added ${added} valid seed URLs to queue`);
  return added;
}

/**
 * Process a batch of URLs from the queue
 * @param {number} batchSize - Number of URLs to process
 * @param {Function} onPageProcessed - Callback for processed pages
 */
async function processBatch(batchSize, onPageProcessed = () => {}) {
  // Get next batch from queue
  const batch = await getNextBatchFromQueue(batchSize);
  
  if (batch.length === 0) {
    console.log('No URLs in queue to process');
    return false;
  }
  
  console.log(`Processing batch of ${batch.length} URLs`);
  
  // Mark URLs as in progress
  for (const item of batch) {
    markUrlInProgress(item.url);
  }
  
  // Process the URLs concurrently with a simple approach
  const promises = batch.map(item => 
    processSinglePage(item.url, item.parent_url, item.depth, onPageProcessed)
  );
  
  try {
    // Wait for all to complete with timeout protection
    await Promise.all(promises);
    
    // If we've accumulated enough pages in the buffer, save them
    if (pageBuffer.length >= Math.min(CONFIG.pageBufferSize / 2, 20)) {
      await savePageBuffer();
    }
  } catch (error) {
    console.error('Error processing batch:', error);
  }
  
  return true;
}

/**
 * Process a single page with tracking
 */
async function processSinglePage(url, parentUrl, depth, onPageProcessed) {
  let success = false;
  
  try {
    await crawlPage(url, parentUrl, depth);
    success = true;
  } catch (error) {
    console.error(`Error in processSinglePage for ${url}:`, error);
  } finally {
    // Call the callback regardless of success/failure
    onPageProcessed(url, success);
  }
  
  return success;
}

/**
 * Get current queue size
 */
async function getQueueSize() {
  try {
    // Get queue size directly from in-memory data structure
    return database.crawl_queue.filter(item => item.status === 'pending').length;
  } catch (error) {
    console.error('Error getting queue size:', error);
    return 0;
  }
}

/**
 * Add high-quality seed URLs for various topics
 */
function getRecommendedSeeds() {
  return [
    // General knowledge & Reference
    'https://en.wikipedia.org/wiki/Main_Page',
    'https://www.britannica.com/',
    'https://plato.stanford.edu/',
    'https://www.gutenberg.org/',
    
    // Science & Research
    'https://www.scientificamerican.com/',
    'https://www.nature.com/',
    'https://www.science.org/',
    'https://phys.org/',
    'https://www.ncbi.nlm.nih.gov/',
    'https://arxiv.org/',
    
    // Medicine & Health
    'https://www.nih.gov/',
    'https://www.who.int/',
    'https://www.mayoclinic.org/',
    'https://medlineplus.gov/',
    'https://www.cdc.gov/',
    'https://www.merckmanuals.com/',
    
    // Survival & Preparedness
    'https://www.ready.gov/',
    'https://www.primalsurvivor.net/',
    'https://www.wildernessawareness.org/',
    'https://theprepared.com/',
    'https://modernsurvivalblog.com/',
    'https://www.survival.org.au/',
    
    // Engineering & Construction
    'https://www.engineeringtoolbox.com/',
    'https://www.eng-tips.com/',
    'https://ocw.mit.edu/courses/find-by-topic/#cat=engineering',
    'https://www.buildingsciencecorp.com/',
    'https://www.structuremag.org/',

    // Agriculture & Food Production
    'https://www.almanac.com/',
    'https://extension.umn.edu/yard-and-garden',
    'https://www.nrcs.usda.gov/',
    'https://www.fao.org/',
    'https://www.permaculturenews.org/',
    'https://smallfarms.cornell.edu/resources/',

    // Computing & Programming
    'https://developer.mozilla.org/',
    'https://www.w3schools.com/',
    'https://www.geeksforgeeks.org/',
    'https://learnxinyminutes.com/',

    // Mathematics
    'https://mathworld.wolfram.com/',
    'https://mathoverflow.net/',

    // History & Culture
    'https://archive.org/',
     
    // Environment & Conservation
    'https://www.conservationfund.org',
    'https://www.treehugger.com',
     
    // Practical DIY Skills 
    'https://www.diyprojects.com',
    'https://www.familyhandyman.com',
  ];
}

// Export functions
module.exports = {
  startCrawler,
  getRecommendedSeeds,
  getQueueSize,
  CONFIG,
  savePageBuffer  // Export this so it can be called manually if needed
}; 