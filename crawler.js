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

// Enhanced configuration settings with reliability improvements
const CONFIG = {
  // Crawling parameters - tuned for reliability
  maxDepth: 3,
  concurrentRequests: 8,                // Reduced for better stability (was 15)
  maxConcurrentRequestsPerDomain: 2,    // Reduced for better behavior (was 3)
  requestTimeout: 15000,                // Increased timeout for stability (was 10000)
  requestDelay: 500,                    // Increased delay for politeness (was 200)
  respectRobotsTxt: false,              // Keep disabled for faster crawling
  
  // Retry settings for improved reliability
  maxRetries: 3,
  retryDelay: 2000,                     // Base delay for retries
  exponentialBackoff: true,             // Use exponential backoff for retries
  
  // In-memory page buffer settings
  pageBufferSize: 100,                  // Reduced for more frequent saves (was 250)
  
  // Connection pooling and reliability
  maxSockets: 50,                       // Limit total sockets
  maxSocketsPerHost: 8,                 // Limit per host
  keepAlive: true,                      // Enable keep-alive
  keepAliveTimeout: 30000,              // 30 second keep-alive
  
  // Error handling
  maxConsecutiveErrors: 10,             // Stop domain after consecutive errors
  errorCooldown: 300000,                // 5 minute cooldown for problematic domains
  
  humanuserAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:109.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.76"
  ],
  
  // Content filtering - same as before
  minTopicMatchScore: 2,
  minTopicsRequired: 1,
  minContentLength: 500,
  
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
    'entertainment': 0.6
  },
  
  allowedDomains: [],
  excludedDomains: [
    'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com',
    'youtube.com', 'linkedin.com', 'reddit.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'walmart.com', 'target.com', 'etsy.com',
    'netflix.com', 'hulu.com', 'disneyplus.com', 'hbomax.com',
    'peacocktv.com', 'primevideo.com', 'twitch.tv', 'ign.com',
    'gamespot.com', 'polygon.com', 'kotaku.com', 'tmz.com',
    'eonline.com', 'variety.com', 'hollywoodreporter.com', 'buzzfeed.com'
  ],
  excludedExtensions: [
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.mp3', '.mp4', '.avi',
    '.mov', '.wmv', '.flv', '.jpg', '.jpeg', '.png', '.gif', '.bmp',
    '.tiff', '.svg', '.webp', '.ico', '.css', '.js', '.json', '.xml'
  ],
  allowedPrefix: ['http://', 'https://'],
  maxPageSize: 50 * 1024 * 1024,
  dataDir: path.join(__dirname, 'data'),
  maxPagesPerDomain: 50,
  allowedContentTypes: [
    'text/html',
    'application/xhtml+xml',
    'text/plain'
  ]
};

// Create axios instance with proper connection management
const httpClient = axios.create({
  timeout: CONFIG.requestTimeout,
  maxRedirects: 3,
  maxContentLength: CONFIG.maxPageSize,
  validateStatus: status => status < 500, // Don't throw on 4xx errors
  httpAgent: require('http').globalAgent,
  httpsAgent: require('https').globalAgent
});

// Configure connection pooling
httpClient.defaults.httpAgent.maxSockets = CONFIG.maxSockets;
httpClient.defaults.httpAgent.maxSocketsPerHost = CONFIG.maxSocketsPerHost;
httpClient.defaults.httpAgent.keepAlive = CONFIG.keepAlive;
httpClient.defaults.httpAgent.keepAliveMsecs = CONFIG.keepAliveTimeout;

httpClient.defaults.httpsAgent.maxSockets = CONFIG.maxSockets;
httpClient.defaults.httpsAgent.maxSocketsPerHost = CONFIG.maxSocketsPerHost;
httpClient.defaults.httpsAgent.keepAlive = CONFIG.keepAlive;
httpClient.defaults.httpsAgent.keepAliveMsecs = CONFIG.keepAliveTimeout;

// Error tracking for domains
const domainErrorCounts = new Map();
const domainCooldowns = new Map();

// Store robots.txt data
const robotsTxtCache = new Map();

// Create in-memory page buffer for batch database operations
const pageBuffer = [];
const pendingUrls = new Set(); // Track URLs being processed to avoid duplicates

/**
 * Buffer a page for batch database insert with improved duplicate handling
 */
async function bufferPage(url, title, content, contentHash, size, topics) {
  // Skip if already in buffer
  if (pendingUrls.has(url)) {
    return;
  }
  
  pendingUrls.add(url);
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
 * Save all pages in buffer to database with optimized error handling
 */
async function savePageBuffer() {
  if (pageBuffer.length === 0) return;
  
  console.log(`Saving batch of ${pageBuffer.length} pages to database...`);
  const startTime = Date.now();
  
  try {
    // Use batch insert for better performance
    if (typeof batchInsertPages === 'function') {
      await batchInsertPages(pageBuffer);
      // Clear tracking sets after successful save
      pageBuffer.forEach(page => pendingUrls.delete(page.url));
      pageBuffer.length = 0;
      
      const timeElapsed = Date.now() - startTime;
      console.log(`Batch save completed in ${timeElapsed}ms`);
    } else {
      // Fallback to individual inserts if batch insert unavailable
      for (const page of pageBuffer) {
        await insertPage(
          page.url,
          page.title,
          page.content,
          page.contentHash,
          page.size,
          null,
          page.topics
        );
        pendingUrls.delete(page.url);
      }
      pageBuffer.length = 0;
    }
  } catch (error) {
    console.error('Error saving page buffer:', error);
    
    // In case of error, try to save individually for resilience
    if (pageBuffer.length > 0) {
      console.log('Trying to save pages individually...');
      const failedPages = [];
      
      for (let i = 0; i < pageBuffer.length; i++) {
        try {
          const page = pageBuffer[i];
          await insertPage(
            page.url,
            page.title,
            page.content,
            page.contentHash,
            page.size,
            null,
            page.topics
          );
          pendingUrls.delete(page.url);
        } catch (e) {
          console.error(`Error saving individual page: ${e.message}`);
          failedPages.push(pageBuffer[i]);
        }
      }
      
      // Keep only failed pages in the buffer
      pageBuffer.length = 0;
      if (failedPages.length > 0) {
        pageBuffer.push(...failedPages);
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
  console.log(`Robots.txt check requested for ${url}. respectRobotsTxt setting: ${CONFIG.respectRobotsTxt}`);
  
  if (!CONFIG.respectRobotsTxt) {
    console.log(`Robots.txt checking disabled in config. Allowing URL: ${url}`);
    return true;
  }
  
  try {
    console.log(`Parsing URL for robots.txt check: ${url}`);
    const parsedUrl = new URL(url);
    const domain = parsedUrl.origin;
    console.log(`Checking robots.txt for domain: ${domain}`);
    
    // Check cache first
    if (!robotsTxtCache.has(domain)) {
      console.log(`No cached robots.txt for domain: ${domain}, fetching now...`);
      // Fetch robots.txt with timeout safety
      try {
        const robotsUrl = `${domain}/robots.txt`;
        console.log(`Fetching robots.txt from: ${robotsUrl}`);
        
        // Create a promise that rejects after a timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Robots.txt request timed out')), 5000);
        });
        
        // Race the actual request against the timeout
        const response = await Promise.race([
          httpClient.get(robotsUrl, { 
            timeout: 5000, // Shorter timeout specifically for robots.txt
            headers: {
              'User-Agent': CONFIG.humanuserAgents[Math.floor(Math.random() * CONFIG.humanuserAgents.length)]
            }
          }),
          timeoutPromise
        ]);
        
        console.log(`Successfully fetched robots.txt from: ${robotsUrl}`);
        
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
        
        console.log(`Parsed robots.txt for ${domain}, found ${rules.allow.length} allow rules and ${rules.disallow.length} disallow rules`);
        robotsTxtCache.set(domain, rules);
      } catch (e) {
        // If can't fetch robots.txt, assume everything is allowed
        console.log(`Error fetching robots.txt for ${domain}: ${e.message}, allowing all URLs by default`);
        robotsTxtCache.set(domain, { allow: [], disallow: [] });
      }
    } else {
      console.log(`Using cached robots.txt for domain: ${domain}`);
    }
    
    // Check against rules
    const rules = robotsTxtCache.get(domain);
    const path = parsedUrl.pathname;
    console.log(`Checking path: ${path} against robots.txt rules for ${domain}`);
    
    // Check allow rules (they take precedence)
    for (const allowPath of rules.allow) {
      if (path.startsWith(allowPath)) {
        console.log(`Path ${path} is explicitly allowed by rule: ${allowPath}`);
        return true;
      }
    }
    
    // Check disallow rules
    for (const disallowPath of rules.disallow) {
      if (path.startsWith(disallowPath)) {
        console.log(`Path ${path} is disallowed by rule: ${disallowPath}`);
        return false;
      }
    }
    
    // If no rule matches, it's allowed
    console.log(`No matching rules for path ${path}, allowing by default`);
    return true;
  } catch (e) {
    // If any error occurs, default to allowing the URL
    console.error(`Error in robots.txt check for ${url}: ${e.message}, allowing by default`);
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
 * Check if a domain is in cooldown due to errors
 */
function isDomainInCooldown(domain) {
  const cooldownEnd = domainCooldowns.get(domain);
  if (cooldownEnd && Date.now() < cooldownEnd) {
    return true;
  }
  if (cooldownEnd && Date.now() >= cooldownEnd) {
    // Cooldown expired, reset error count
    domainCooldowns.delete(domain);
    domainErrorCounts.set(domain, 0);
  }
  return false;
}

/**
 * Record an error for a domain
 */
function recordDomainError(domain) {
  const count = domainErrorCounts.get(domain) || 0;
  domainErrorCounts.set(domain, count + 1);
  
  if (count + 1 >= CONFIG.maxConsecutiveErrors) {
    console.log(`Domain ${domain} hit error limit, entering cooldown for ${CONFIG.errorCooldown / 60000} minutes`);
    domainCooldowns.set(domain, Date.now() + CONFIG.errorCooldown);
  }
}

/**
 * Reset error count for successful crawl
 */
function resetDomainErrors(domain) {
  domainErrorCounts.set(domain, 0);
}

/**
 * Enhanced request function with retries and better error handling
 */
async function makeRequest(url, retryCount = 0) {
  const domain = extractDomain(url);
  
  // Check domain cooldown
  if (isDomainInCooldown(domain)) {
    throw new Error(`Domain ${domain} is in cooldown due to errors`);
  }
  
  try {
    const userAgent = CONFIG.humanuserAgents[Math.floor(Math.random() * CONFIG.humanuserAgents.length)];
    
    const response = await httpClient.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      responseType: 'arraybuffer'
    });
    
    // Reset error count on success
    resetDomainErrors(domain);
    
    return response;
  } catch (error) {
    console.error(`Request failed for ${url} (attempt ${retryCount + 1}):`, error.message);
    
    // Record domain error
    recordDomainError(domain);
    
    // Retry logic
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.exponentialBackoff 
        ? CONFIG.retryDelay * Math.pow(2, retryCount)
        : CONFIG.retryDelay;
      
      console.log(`Retrying ${url} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(url, retryCount + 1);
    }
    
    throw error;
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
    console.log(`Checking robots.txt for: ${url}`);
    if (!await isAllowedByRobotsTxt(url)) {
      console.log(`Skipping (robots.txt): ${url}`);
      markUrlFailed(url, "Blocked by robots.txt");
      return;
    }
    console.log(`Robots.txt check passed for: ${url}`);
    
    // Get domain for rate limiting
    const domain = extractDomain(url);
    if (!domain) {
      console.log(`Skipping (invalid URL): ${url}`);
      markUrlFailed(url, "Invalid URL");
      return;
    }
    
    // Apply rate limiting
    console.log(`Acquiring domain lock for: ${domain}`);
    await getDomainLock(domain);
    console.log(`Domain lock acquired for: ${domain}`);
    
    // Process the crawl
    return processCrawl(url, parentUrl, depth).finally(() => {
      // Release the domain lock
      console.log(`Releasing domain lock for: ${domain}`);
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
    console.log(`Initializing domain count for: ${domain}`);
    domainCounts.set(domain, 0);
  }
  
  let waitCount = 0;
  // Wait until we can acquire a lock
  while (domainCounts.get(domain) >= CONFIG.maxConcurrentRequestsPerDomain) {
    waitCount++;
    if (waitCount === 1 || waitCount % 10 === 0) {  // Log on first wait and every 10th wait
      console.log(`Waiting for domain lock on ${domain} - currently ${domainCounts.get(domain)}/${CONFIG.maxConcurrentRequestsPerDomain} active (wait #${waitCount})`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Increment the count for this domain
  const currentCount = domainCounts.get(domain);
  domainCounts.set(domain, currentCount + 1);
  console.log(`Lock acquired for ${domain} - now ${domainCounts.get(domain)}/${CONFIG.maxConcurrentRequestsPerDomain} active`);
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
      console.log(`Lock released for ${domain} - now ${domainCounts.get(domain)}/${CONFIG.maxConcurrentRequestsPerDomain} active`);
    } else {
      console.warn(`Attempt to release lock for ${domain} when count is already ${count}`);
    }
  } else {
    console.warn(`Attempt to release lock for unknown domain: ${domain}`);
  }
}

/**
 * Process the actual crawling after rate limiting with optimized HTML processing
 */
async function processCrawl(url, parentUrl, depth) {
  console.log(`Starting fetch for: ${url}`);
  
  // Add a timeout for the entire function
  const timeout = setTimeout(() => {
    console.error(`ERROR: Processing of ${url} timed out after 60 seconds. Terminating.`);
    // This will crash the process but prevent indefinite hanging
    process.exit(1);
  }, 60000); // 60 second timeout
  
  try {
    // Optimized fetch with streamlined error handling
    let response;
    let retries = 3;
    
    while (retries > 0) {
      try {
        console.log(`Fetch attempt ${4-retries} for: ${url}`);
        response = await makeRequest(url, retries);
        console.log(`Fetch successful for: ${url} (status: ${response.status})`);
        break; // Success, exit retry loop
      } catch (e) {
        console.error(`Fetch error for ${url}: ${e.message}`);
        retries--;
        if (retries === 0) {
          throw e;
        }
        const backoffTime = 1000 * Math.pow(2, 3-retries);
        console.log(`Retrying in ${backoffTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
    
    // Quick status code check
    if (response.status !== 200) {
      console.log(`Non-200 response for ${url}: ${response.status}`);
      if ([401, 403, 410].includes(response.status)) {
        markUrlFailed(url, `HTTP error: ${response.status}`);
      } else if (depth < CONFIG.maxDepth) {
        await addToQueue(url, parentUrl, depth, 1);
      }
      return;
    }
    
    // Efficient content type check
    const contentType = response.headers['content-type'] || '';
    if (!CONFIG.allowedContentTypes.some(type => contentType.includes(type))) {
      markUrlFailed(url, `Unsupported content type: ${contentType}`);
      return;
    }
    
    // Optimized content conversion
    const contentBuffer = Buffer.from(response.data);
    let htmlContent;
    
    try {
      htmlContent = contentBuffer.toString('utf8');
    } catch (e) {
      htmlContent = contentBuffer.toString('latin1');
    }
    
    // Single cheerio parse for all operations
    const $ = cheerio.load(htmlContent);
    
    // Extract data in a single pass
    const title = $('title').text().trim() || url;
    
    // More targeted content extraction for better performance
    const bodyText = $('article, main, .content, [role="main"]').text() || 
                     $('p, h1, h2, h3, h4, h5, h6').text() || 
                     $('body').text();
    
    // Optimize link extraction if depth allows
    if (depth < CONFIG.maxDepth) {
      // Use Set for deduplication
      const links = new Set();
      const domain = extractDomain(url);
      
      // More efficient link selection
      $('a[href]:not([rel="nofollow"])').each((_, link) => {
        const href = $(link).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, url).toString();
            if (shouldCrawlUrl(absoluteUrl)) {
              links.add(absoluteUrl);
            }
          } catch {
            // Skip invalid URLs
          }
        }
      });
      
      // Process links in batch with Map to track domains
      const linksByDomain = new Map();
      
      // Group links by domain for prioritization
      for (const link of links) {
        try {
          const linkDomain = extractDomain(link);
          if (!linksByDomain.has(linkDomain)) {
            linksByDomain.set(linkDomain, []);
          }
          linksByDomain.get(linkDomain).push(link);
        } catch {
          // Skip invalid URLs
        }
      }
      
      // Add links with prioritization and limiting per domain
      const linkPromises = [];
      for (const [linkDomain, domainLinks] of linksByDomain) {
        // Limit links per domain for better distribution
        const maxLinksPerDomain = 10;
        const selectedLinks = domainLinks.slice(0, maxLinksPerDomain);
        
        for (const link of selectedLinks) {
          const priority = calculateUrlPriority(link, depth + 1);
          linkPromises.push(addToQueue(link, url, depth + 1, priority));
        }
      }
      
      await Promise.all(linkPromises);
      console.log(`Found ${links.size} links, added to queue`);
    }
    
    // Skip if content too short
    if (bodyText.length < CONFIG.minContentLength) {
      return;
    }
    
    // Classify content
    const topics = classifyContent(
      title, 
      bodyText,
      CONFIG.minTopicMatchScore,
      CONFIG.topicWeights
    );
    
    if (Object.keys(topics).length < CONFIG.minTopicsRequired) {
      return;
    }
    
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
  } finally {
    // Clear the timeout
    clearTimeout(timeout);
  }
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
  
  // Small delay to ensure database is fully initialized
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check if database functions are available
  if (!database || !insertPage || !addToQueue || !getNextBatchFromQueue || 
      !markUrlInProgress || !markUrlFailed || !urlExists || !queueExists) {
    console.error("ERROR: Database functions not available. Crawler cannot start.");
    return;
  }
  
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
  let lastProgressTime = Date.now();  // Track when we last made progress
  
  while (running) {
    // Add a failsafe check - if no progress in 2 minutes, reset system
    const timeSinceProgress = Date.now() - lastProgressTime;
    if (timeSinceProgress > 120000) {  // 2 minutes
      console.error(`ALERT: No crawling progress in ${timeSinceProgress/1000} seconds. Resetting crawler state...`);
      
      // Reset domain locks
      domainCounts.clear();
      robotsTxtCache.clear();
      
      // Add more seeds to try to restart
      await addSeedUrlsToQueue(originalSeeds.slice(0, 5));
      lastProgressTime = Date.now();
    }
    
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
      if (success) {
        processed++;
        lastProgressTime = Date.now();  // Update progress timestamp
      }
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
 * Process a batch of URLs from the queue with optimized concurrency
 */
async function processBatch(batchSize, onPageProcessed = () => {}) {
  try {
    // Get next batch with improved domain balancing
    const batch = await getNextBatchFromQueue(batchSize);
    
    if (!batch || batch.length === 0) {
      return false;
    }
    
    console.log(`Processing batch of ${batch.length} URLs`);
    
    // Mark URLs as in progress in bulk
    const urls = batch.map(item => item.url);
    
    try {
      await markUrlInProgress(urls);
    } catch (error) {
      console.error("Error marking URLs as in progress:", error);
      // Continue anyway to process the batch
    }
    
    // Process each URL individually to avoid one failure affecting others
    const promises = [];
    for (const item of batch) {
      // Skip null/undefined items
      if (!item || !item.url) continue;
      
      // Process URLs individually for better resilience
      promises.push(
        processSinglePage(item.url, item.parent_url, item.depth, onPageProcessed)
          .catch(error => {
            console.error(`Error processing ${item.url}:`, error.message);
            // Still count as processed
            onPageProcessed(item.url, false);
          })
      );
    }
    
    // Wait for all URLs to be processed
    await Promise.all(promises);
    
    // Save buffer if it has enough items
    if (pageBuffer.length >= CONFIG.pageBufferSize / 2) {
      try {
        await savePageBuffer();
      } catch (error) {
        console.error("Error saving page buffer:", error);
      }
    }
    
    return true;
  } catch (error) {
    console.error("Error in processBatch:", error);
    return false;
  }
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