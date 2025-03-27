const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { parse } = require('node-html-parser');
const { 
  insertPage, 
  addToQueue, 
  getNextBatchFromQueue, 
  markUrlInProgress,
  markUrlFailed,
  urlExists
} = require('./database');
const { compressData } = require('./compression');
const { classifyContent } = require('./classifier');

// Configuration settings
const CONFIG = {
  // Crawling parameters
  maxDepth: 3,                    // Maximum depth to crawl
  concurrentRequests: 5,          // Number of concurrent requests
  requestTimeout: 10000,          // Request timeout in ms
  requestDelay: 500,              // Delay between batches in ms
  respectRobotsTxt: true,         // Whether to respect robots.txt
  userAgent: 'WorldEndArchive/1.0',  // User agent for requests
  
  // Content filtering
  minTopicMatchScore: 2,          // Minimum score to consider a topic match
  minTopicsRequired: 1,           // Minimum number of topics required to archive content
  minContentLength: 500,          // Minimum content length in characters
  
  // Filters
  allowedDomains: [],           // Empty means all domains, specific items restrict to those domains
  excludedDomains: [           // Domains to explicitly exclude  
    'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com',
    'youtube.com', 'linkedin.com', 'reddit.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'walmart.com', 'target.com', 'etsy.com'
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
  dataDir: path.join(__dirname, 'data')
};

// Store robots.txt data
const robotsTxtCache = new Map();

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
            'User-Agent': CONFIG.userAgent
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
            inRelevantAgent = (agent === '*' || CONFIG.userAgent.includes(agent));
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
      return;
    }
    
    // Fetch page
    const response = await axios.get(url, {
      timeout: CONFIG.requestTimeout,
      maxContentLength: CONFIG.maxPageSize,
      headers: {
        'User-Agent': CONFIG.userAgent
      },
      responseType: 'arraybuffer'  // Use arraybuffer to handle binary content
    });
    
    // Determine content type
    const contentType = response.headers['content-type'] || '';
    
    // Skip non-HTML content
    if (!contentType.includes('text/html')) {
      console.log(`Skipping (not HTML): ${url}`);
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
    
    // Extract title using cheerio
    const $ = cheerio.load(htmlContent);
    const title = $('title').text().trim() || url;
    
    // Extract text content for classification
    const bodyText = $('body').text();
    
    // Skip if content is too short
    if (bodyText.length < CONFIG.minContentLength) {
      console.log(`Skipping (content too short): ${url}`);
      return;
    }
    
    // Classify content
    const topics = classifyContent(title, bodyText, CONFIG.minTopicMatchScore);
    
    // Check if any topics matched with good confidence
    const topicCount = Object.keys(topics).length;
    if (topicCount < CONFIG.minTopicsRequired) {
      console.log(`Skipping (no relevant topics found): ${url}`);
      return;
    }
    
    console.log(`Content classified into ${topicCount} topics: ${Object.keys(topics).join(', ')}`);
    
    // Compress content with LZMA
    const compressionResult = await compressData(htmlContent);
    
    // Store in database
    await insertPage(
      url, 
      title, 
      compressionResult.compressed, 
      compressionResult.hash,
      compressionResult.originalSize, 
      compressionResult.compressedSize,
      topics
    );
    
    // Extract links for further crawling if we haven't reached max depth
    if (depth < CONFIG.maxDepth) {
      const links = [];
      
      // Find all links
      $('a').each((_, link) => {
        const href = $(link).attr('href');
        if (href) {
          try {
            // Convert to absolute URL
            const absoluteUrl = new URL(href, url).toString();
            
            // Check if URL should be crawled
            if (shouldCrawlUrl(absoluteUrl)) {
              links.push(absoluteUrl);
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });
      
      // Add unique links to queue
      const newLinks = [];
      for (const link of links) {
        if (await addToQueue(link, url, depth + 1)) {
          newLinks.push(link);
        }
      }
      
      console.log(`Found ${links.length} links, added ${newLinks.length} new ones to queue`);
    }
    
    console.log(`Successfully archived: ${url}`);
  } catch (error) {
    console.error(`Error crawling ${url}: ${error.message}`);
    markUrlFailed(url, error.message);
  }
}

/**
 * Process a batch of URLs from the queue
 * @param {number} batchSize - Number of URLs to process
 */
async function processBatch(batchSize) {
  // Get next batch from queue
  const batch = await getNextBatchFromQueue(batchSize);
  
  if (batch.length === 0) {
    console.log('No URLs in queue to process');
    return false;
  }
  
  console.log(`Processing batch of ${batch.length} URLs`);
  
  // Mark URLs as in progress
  markUrlInProgress(batch.map(item => item.url));
  
  // Process each URL
  const promises = batch.map(item => 
    crawlPage(item.url, item.parent_url, item.depth)
  );
  
  // Wait for all to complete with timeout protection
  await Promise.all(promises);
  
  return true;
}

/**
 * Start crawler with seed URLs
 * @param {Array<string>} seedUrls - Initial URLs to crawl
 */
async function startCrawler(seedUrls) {
  console.log('Starting crawler');
  
  // Initialize data directory
  initCrawler();
  
  // Add seed URLs to queue with depth 0 and high priority
  for (const url of seedUrls) {
    await addToQueue(url, null, 0, 10);  // Priority 10 for seed URLs
  }
  
  // Process URLs in batches until queue is empty or stopped
  let running = true;
  let consecutive404Count = 0;
  
  while (running) {
    const batchProcessed = await processBatch(CONFIG.concurrentRequests);
    
    if (!batchProcessed) {
      consecutive404Count++;
      
      if (consecutive404Count >= 3) {
        console.log('Queue appears to be empty, stopping crawler');
        running = false;
      }
    } else {
      consecutive404Count = 0;
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
  }
  
  console.log('Crawler finished');
}

/**
 * Add high-quality seed URLs for various topics
 */
function getRecommendedSeeds() {
  return [
    // General knowledge
    'https://en.wikipedia.org/wiki/Main_Page',
    'https://www.britannica.com/',
    
    // Science & Technology
    'https://www.scientificamerican.com/',
    'https://www.nature.com/',
    'https://www.science.org/',
    'https://www.technologyreview.com/',
    
    // Medicine & Health
    'https://www.nih.gov/',
    'https://www.who.int/',
    'https://www.mayoclinic.org/',
    'https://medlineplus.gov/',
    
    // Survival & Preparedness
    'https://www.ready.gov/',
    'https://www.primalsurvivor.net/',
    'https://www.wildernessawareness.org/',
    
    // Engineering & Construction
    'https://www.engineeringtoolbox.com/',
    'https://www.eng-tips.com/',
    
    // Agriculture & Food
    'https://www.almanac.com/',
    'https://extension.umn.edu/yard-and-garden',
    'https://www.nrcs.usda.gov/',
    
    // Computing & Programming
    'https://developer.mozilla.org/',
    'https://www.w3schools.com/',
    'https://www.geeksforgeeks.org/',
    
    // Mathematics
    'https://www.mathsisfun.com/',
    'https://tutorial.math.lamar.edu/',
    
    // History & Culture
    'https://www.smithsonianmag.com/',
    'https://www.worldhistory.org/',
    
    // Literature
    'https://www.gutenberg.org/',
    'https://www.poetryfoundation.org/'
  ];
}

// Export functions
module.exports = {
  startCrawler,
  getRecommendedSeeds,
  CONFIG
}; 