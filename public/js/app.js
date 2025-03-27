/**
 * WorldEndArchive - Frontend Application
 * Post-apocalyptic knowledge preservation system
 */

// Application state
const appState = {
  topics: [],
  selectedTopics: [],
  searchQuery: '',
  isLoading: false,
  currentView: 'search', // 'search', 'results', 'content'
  searchResults: [],
  currentPage: null,
  stats: {},
  crawlerStats: {
    isRunning: false,
    queueSize: 0,
    processedUrls: 0,
    crawlSpeed: 0,
    runtime: 0,
    successRate: 100,
    lastProcessedUrl: null
  },
  dbStats: {
    fileSize: '0 B',
    fileSizeBytes: 0,
    totalPages: 0,
    totalSizeRaw: '0 B',
    totalSizeCompressed: '0 B',
    compressionRatio: '0:0',
    topTopics: []
  }
};

// DOM Elements
let elements = {};

// Polling interval for stats
let statsInterval = null;
const MAX_DB_SIZE_BYTES = 8 * 1024 * 1024 * 1024; // 8GB

/**
 * Initialize the application
 */
async function initApp() {
  // Cache DOM elements
  cacheElements();
  
  // Set up event listeners
  setupEventListeners();
  
  // Apply CRT flicker effect
  document.body.classList.add('flicker-effect');
  
  // Load application data
  await Promise.all([
    loadTopics(),
    loadStats(),
    loadCrawlerStats()
  ]);
  
  // Initialize UI
  updateTopicsUI();
  updateStatsUI();
  
  // Start polling for crawler stats
  startStatsPoll();
  
  console.log('WorldEndArchive initialized');
}

/**
 * Cache DOM elements for faster access
 */
function cacheElements() {
  elements = {
    // Search interface
    searchInput: document.getElementById('search-input'),
    searchButton: document.getElementById('search-button'),
    topicsContainer: document.getElementById('topics-container'),
    
    // Results display
    resultsContainer: document.getElementById('results-container'),
    resultsCount: document.getElementById('results-count'),
    resultsList: document.getElementById('results-list'),
    noResults: document.getElementById('no-results'),
    loadingIndicator: document.getElementById('loading'),
    
    // Content viewer
    contentViewer: document.getElementById('content-viewer'),
    contentTitle: document.getElementById('content-title'),
    contentBody: document.getElementById('content-body'),
    contentClose: document.getElementById('content-close'),
    
    // Stats
    statsContainer: document.getElementById('stats-container'),
    totalPages: document.getElementById('total-pages'),
    totalSizeRaw: document.getElementById('total-size-raw'),
    totalSizeCompressed: document.getElementById('total-size-compressed'),
    compressionRatio: document.getElementById('compression-ratio'),
    lastCrawl: document.getElementById('last-crawl'),
    systemStatus: document.getElementById('system-status'),
    topicDistribution: document.getElementById('topic-distribution'),
    
    // Crawler Stats
    crawlerStatusIndicator: document.getElementById('crawler-status-indicator'),
    crawlerStatusText: document.getElementById('crawler-status-text'),
    dbSize: document.getElementById('db-size'),
    dbSizePercent: document.getElementById('db-size-percent'),
    crawlSpeed: document.getElementById('crawl-speed'),
    queueSize: document.getElementById('queue-size'),
    processedUrls: document.getElementById('processed-urls'),
    crawlerRuntime: document.getElementById('crawler-runtime'),
    successRate: document.getElementById('success-rate'),
    lastUrl: document.getElementById('last-url'),
    downloadDbButton: document.getElementById('download-db')
  };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Search form submission
  elements.searchButton.addEventListener('click', performSearch);
  elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  
  // Content viewer close
  elements.contentClose.addEventListener('click', closeContentViewer);
  
  // Download button confirmation
  if (elements.downloadDbButton) {
    elements.downloadDbButton.addEventListener('click', function(e) {
      const dbSizeStr = elements.dbSize.textContent;
      // If database is larger than 100MB, show confirmation
      if (appState.dbStats.fileSizeBytes > 100 * 1024 * 1024) {
        if (!confirm(`Database size is ${dbSizeStr}. Download may take some time. Continue?`)) {
          e.preventDefault();
        }
      }
    });
  }
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // ESC key to close content viewer
    if (e.key === 'Escape' && appState.currentView === 'content') {
      closeContentViewer();
    }
  });
}

/**
 * Start polling for crawler stats
 */
function startStatsPoll() {
  // Clear existing interval if any
  if (statsInterval) {
    clearInterval(statsInterval);
  }
  
  // Initial load
  loadCrawlerStats();
  
  // Set up interval for polling
  statsInterval = setInterval(loadCrawlerStats, 3000); // Update every 3 seconds
}

/**
 * Load crawler stats from API
 */
async function loadCrawlerStats() {
  try {
    const response = await fetch('/api/crawler-stats');
    const stats = await response.json();
    
    // Update application state
    appState.crawlerStats = stats.crawler;
    appState.dbStats = stats.database;
    
    // Update UI
    updateCrawlerStatsUI();
    
    return stats;
  } catch (error) {
    console.error('Failed to load crawler stats:', error);
    return {};
  }
}

/**
 * Update crawler stats UI
 */
function updateCrawlerStatsUI() {
  const { crawlerStats, dbStats } = appState;
  
  // Crawler status indicator
  if (elements.crawlerStatusIndicator && elements.crawlerStatusText) {
    if (crawlerStats.isRunning) {
      elements.crawlerStatusIndicator.className = 'status-indicator status-online';
      elements.crawlerStatusText.textContent = 'ACTIVE';
    } else {
      elements.crawlerStatusIndicator.className = 'status-indicator status-offline';
      elements.crawlerStatusText.textContent = 'IDLE';
    }
  }
  
  // Database size
  if (elements.dbSize) {
    elements.dbSize.textContent = dbStats.fileSize || '0 B';
  }
  
  // Database size percentage
  if (elements.dbSizePercent) {
    const percentFilled = Math.min(100, Math.round((dbStats.fileSizeBytes / MAX_DB_SIZE_BYTES) * 100));
    elements.dbSizePercent.textContent = `${percentFilled}%`;
    
    // Add progress bar if not exists
    if (!document.querySelector('.db-progress')) {
      const progressBar = document.createElement('div');
      progressBar.className = 'db-progress';
      
      const progressFill = document.createElement('div');
      progressFill.className = 'db-progress-fill';
      progressFill.style.width = `${percentFilled}%`;
      
      progressBar.appendChild(progressFill);
      elements.dbSize.parentNode.appendChild(progressBar);
    } else {
      // Update existing progress bar
      const progressFill = document.querySelector('.db-progress-fill');
      if (progressFill) {
        progressFill.style.width = `${percentFilled}%`;
      }
    }
  }
  
  // Crawl speed
  if (elements.crawlSpeed) {
    elements.crawlSpeed.textContent = crawlerStats.crawlSpeed || '0';
  }
  
  // Queue size
  if (elements.queueSize) {
    elements.queueSize.textContent = crawlerStats.queueSize || '0';
  }
  
  // Processed URLs
  if (elements.processedUrls) {
    elements.processedUrls.textContent = crawlerStats.processedUrls || '0';
  }
  
  // Runtime
  if (elements.crawlerRuntime) {
    elements.crawlerRuntime.textContent = formatTime(crawlerStats.runtime || 0);
  }
  
  // Success rate
  if (elements.successRate) {
    elements.successRate.textContent = `${crawlerStats.successRate || 100}%`;
  }
  
  // Last URL
  if (elements.lastUrl) {
    elements.lastUrl.textContent = crawlerStats.lastProcessedUrl || 'N/A';
    elements.lastUrl.title = crawlerStats.lastProcessedUrl || '';
  }
  
  // Update topic distribution
  updateTopicDistribution();
}

/**
 * Update topic distribution chart
 */
function updateTopicDistribution() {
  if (!elements.topicDistribution) return;
  
  const topTopics = appState.dbStats.topTopics || [];
  if (topTopics.length === 0) {
    elements.topicDistribution.innerHTML = '<div class="no-data">No topic data available</div>';
    return;
  }
  
  // Get max count for scaling
  const maxCount = Math.max(...topTopics.map(t => t.count));
  
  // Clear existing content
  elements.topicDistribution.innerHTML = '';
  
  // Create bars for each topic
  topTopics.forEach(topic => {
    const percent = Math.round((topic.count / maxCount) * 100);
    
    const topicBar = document.createElement('div');
    topicBar.className = 'topic-bar';
    
    const barHeader = document.createElement('div');
    barHeader.className = 'topic-bar-header';
    
    const topicName = document.createElement('div');
    topicName.className = 'topic-name';
    topicName.textContent = topic.topic.toUpperCase();
    
    const topicCount = document.createElement('div');
    topicCount.className = 'topic-count';
    topicCount.textContent = topic.count;
    
    barHeader.appendChild(topicName);
    barHeader.appendChild(topicCount);
    
    const barProgress = document.createElement('div');
    barProgress.className = 'topic-bar-progress';
    
    const barFill = document.createElement('div');
    barFill.className = 'topic-bar-fill';
    barFill.style.width = `${percent}%`;
    
    barProgress.appendChild(barFill);
    
    topicBar.appendChild(barHeader);
    topicBar.appendChild(barProgress);
    
    elements.topicDistribution.appendChild(topicBar);
  });
}

/**
 * Format seconds to HH:MM:SS
 */
function formatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

/**
 * Load available topics from API
 */
async function loadTopics() {
  try {
    const response = await fetch('/api/topics');
    const topics = await response.json();
    appState.topics = topics;
    return topics;
  } catch (error) {
    console.error('Failed to load topics:', error);
    return [];
  }
}

/**
 * Load system statistics from API
 */
async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();
    appState.stats = stats;
    return stats;
  } catch (error) {
    console.error('Failed to load stats:', error);
    return {};
  }
}

/**
 * Render topics in the UI
 */
function updateTopicsUI() {
  if (!elements.topicsContainer) return;
  
  // Clear existing topics
  elements.topicsContainer.innerHTML = '';
  
  // Create topic header
  const topicsTitle = document.createElement('div');
  topicsTitle.className = 'topics-title';
  topicsTitle.textContent = 'KNOWLEDGE SECTORS';
  elements.topicsContainer.appendChild(topicsTitle);
  
  // Create topics grid
  const topicsGrid = document.createElement('div');
  topicsGrid.className = 'topics-grid';
  
  // Add each topic
  appState.topics.forEach(topic => {
    const topicTag = document.createElement('div');
    topicTag.className = 'topic-tag';
    if (appState.selectedTopics.includes(topic.id)) {
      topicTag.classList.add('active');
    }
    topicTag.textContent = topic.name;
    topicTag.dataset.topic = topic.id;
    
    // Toggle topic selection on click
    topicTag.addEventListener('click', () => {
      toggleTopic(topic.id);
      topicTag.classList.toggle('active');
    });
    
    topicsGrid.appendChild(topicTag);
  });
  
  elements.topicsContainer.appendChild(topicsGrid);
}

/**
 * Toggle topic selection
 */
function toggleTopic(topicId) {
  const index = appState.selectedTopics.indexOf(topicId);
  if (index === -1) {
    appState.selectedTopics.push(topicId);
  } else {
    appState.selectedTopics.splice(index, 1);
  }
}

/**
 * Update statistics display
 */
function updateStatsUI() {
  if (!elements.statsContainer) return;
  
  const stats = appState.stats;
  
  if (elements.totalPages) {
    elements.totalPages.textContent = stats.totalPages || '0';
  }
  
  if (elements.totalSizeRaw) {
    elements.totalSizeRaw.textContent = stats.totalSizeRaw || '0 B';
  }
  
  if (elements.totalSizeCompressed) {
    elements.totalSizeCompressed.textContent = stats.totalSizeCompressed || '0 B';
  }
  
  if (elements.compressionRatio) {
    elements.compressionRatio.textContent = stats.compressionRatio || '0:0';
  }
  
  if (elements.lastCrawl) {
    const lastCrawlDate = stats.lastCrawlDate ? new Date(stats.lastCrawlDate) : null;
    elements.lastCrawl.textContent = lastCrawlDate ? 
      lastCrawlDate.toLocaleString() : 'NEVER';
  }
  
  // Update system status indicator
  if (elements.systemStatus) {
    const statusIndicator = document.createElement('span');
    statusIndicator.className = 'status-indicator status-online';
    
    const statusText = document.createElement('span');
    statusText.textContent = 'SYSTEM OPERATIONAL';
    
    elements.systemStatus.innerHTML = '';
    elements.systemStatus.appendChild(statusIndicator);
    elements.systemStatus.appendChild(statusText);
  }
}

/**
 * Perform search based on current query and selected topics
 */
async function performSearch() {
  // Update search query from input
  appState.searchQuery = elements.searchInput.value.trim();
  
  // Show loading state
  setLoading(true);
  
  try {
    // Build query parameters
    const params = new URLSearchParams();
    if (appState.searchQuery) {
      params.append('query', appState.searchQuery);
    }
    if (appState.selectedTopics.length > 0) {
      params.append('topics', appState.selectedTopics.join(','));
    }
    
    // Fetch search results
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();
    
    // Update application state
    appState.searchResults = data.results || [];
    appState.currentView = 'results';
    
    // Update UI
    renderSearchResults();
  } catch (error) {
    console.error('Search failed:', error);
    elements.resultsList.innerHTML = `
      <div class="error-message">
        ERROR: SYSTEM MALFUNCTION<br>
        ${error.message}
      </div>
    `;
  } finally {
    setLoading(false);
  }
}

/**
 * Render search results in the UI
 */
function renderSearchResults() {
  if (!elements.resultsContainer) return;
  
  const results = appState.searchResults;
  
  // Update results count
  if (elements.resultsCount) {
    elements.resultsCount.innerHTML = `
      <span class="count-label">FOUND</span>
      <em>${results.length}</em>
      <span class="count-suffix">RECORDS</span>
    `;
  }
  
  // Clear existing results
  elements.resultsList.innerHTML = '';
  
  // Show no results message if needed
  if (results.length === 0) {
    if (elements.noResults) {
      elements.noResults.style.display = 'block';
    }
    return;
  }
  
  // Hide no results message
  if (elements.noResults) {
    elements.noResults.style.display = 'none';
  }
  
  // Render each result
  results.forEach(result => {
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    
    // Format topics
    const topicsHTML = result.topics && result.topics.length > 0 
      ? `
        <div class="result-topics">
          ${result.topics.map(topic => 
            `<span class="result-topic">${topic}</span>`
          ).join('')}
        </div>
      ` 
      : '';
    
    // Format date
    const date = result.date ? new Date(result.date).toLocaleDateString() : '';
    
    resultItem.innerHTML = `
      <h3 class="result-title">${result.title || 'Untitled Document'}</h3>
      <div class="result-url">${result.url}</div>
      ${topicsHTML}
      <div class="result-date">${date}</div>
    `;
    
    // Add click event to view content
    resultItem.addEventListener('click', () => viewContent(result.id));
    
    elements.resultsList.appendChild(resultItem);
  });
}

/**
 * View the content of a specific page
 */
async function viewContent(id) {
  // Show loading state
  setLoading(true);
  
  try {
    // Fetch content
    const response = await fetch(`/api/content/${id}`);
    
    // Check if HTML response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      // Open content viewer with iframe
      openContentViewer();
      
      // Create iframe for isolated content
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-same-origin';
      elements.contentBody.innerHTML = '';
      elements.contentBody.appendChild(iframe);
      
      // Get response text
      const html = await response.text();
      
      // Set iframe content
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();
      
      // Set title
      const title = iframeDoc.title || 'Archived Content';
      elements.contentTitle.textContent = title;
    } else {
      // JSON response for text content
      const data = await response.json();
      
      // Open content viewer
      openContentViewer();
      
      // Set content
      elements.contentTitle.textContent = data.title || 'Archived Content';
      elements.contentBody.innerHTML = `
        <div class="text-content">
          <p class="content-url">${data.url}</p>
          <div class="content-text">${data.content}</div>
        </div>
      `;
    }
    
    // Update application state
    appState.currentView = 'content';
  } catch (error) {
    console.error('Failed to load content:', error);
    alert(`ERROR: Could not retrieve content (${error.message})`);
  } finally {
    setLoading(false);
  }
}

/**
 * Open the content viewer
 */
function openContentViewer() {
  elements.contentViewer.classList.add('active');
  document.body.style.overflow = 'hidden'; // Prevent scrolling behind viewer
}

/**
 * Close the content viewer
 */
function closeContentViewer() {
  elements.contentViewer.classList.remove('active');
  document.body.style.overflow = ''; // Restore scrolling
  appState.currentView = 'results';
}

/**
 * Set loading state
 */
function setLoading(isLoading) {
  appState.isLoading = isLoading;
  
  if (elements.loadingIndicator) {
    elements.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
  }
}

/**
 * Utility: Format date
 */
function formatDate(dateString) {
  if (!dateString) return 'UNKNOWN';
  
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    return 'INVALID DATE';
  }
  
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp); 