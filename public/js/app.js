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
    lastProcessedUrl: null,
    infiniteMode: false,
    maxDbSize: 0
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
  
  try {
    // Load application data
    const promises = [loadCrawlerStats()];
    
    if (elements.topicsContainer) {
      promises.push(loadTopics());
    }
    
    if (elements.statsContainer) {
      promises.push(loadStats());
    }
    
    await Promise.all(promises);
    
    // Initialize UI - only if elements exist
    if (elements.topicsContainer) {
      updateTopicsUI();
    }
    
    if (elements.statsContainer) {
      updateStatsUI();
    }
    
    // Start polling for crawler stats
    startStatsPoll();
    
    console.log('WorldEndArchive initialized');
  } catch (error) {
    console.error('Error initializing application:', error);
  }
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
    downloadDbButton: document.getElementById('download-db'),
    
    // Crawler mode panel
    standalonePanel: document.querySelector('.standalone-panel'),
    standalonePanelTitle: document.querySelector('.standalone-title')
  };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Search form submission
  if (elements.searchButton) {
    elements.searchButton.addEventListener('click', performSearch);
  }
  
  if (elements.searchInput) {
    elements.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }
  
  // Content viewer close
  if (elements.contentClose) {
    elements.contentClose.addEventListener('click', closeContentViewer);
  }
  
  // Download button confirmation
  if (elements.downloadDbButton) {
    elements.downloadDbButton.addEventListener('click', function(e) {
      e.preventDefault(); // Prevent default to handle manually
      
      initiateDownload();
    });
  }
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // ESC key to close content viewer
    if (e.key === 'Escape' && appState.currentView === 'content' && elements.contentViewer) {
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
 * Load crawler stats from API using enhanced real-time endpoint
 */
async function loadCrawlerStats() {
  try {
    console.log('Fetching real-time crawler stats...');
    const response = await fetch('/api/stats-realtime');
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    const stats = await response.json();
    console.log('Received real-time stats:', stats);
    
    // Update application state with new structure
    appState.crawlerStats = {
      isRunning: stats.crawler.isRunning,
      queueSize: stats.crawler.queueSize,
      processedUrls: stats.crawler.processedUrls,
      crawlSpeed: stats.crawler.crawlSpeed,
      totalRuntime: stats.crawler.totalRuntime,
      successRate: stats.crawler.successRate,
      lastProcessedUrl: stats.crawler.lastProcessedUrl,
      maxDbSize: stats.database.maxSizeBytes
    };
    
    appState.dbStats = {
      fileSize: stats.database.currentFileSize,
      fileSizeBytes: stats.database.currentFileSizeBytes,
      totalPages: stats.database.totalPages,
      totalSizeRaw: stats.database.totalSizeRaw,
      storageProgress: stats.database.storageProgress,
      lastModified: stats.database.lastModified,
      topTopics: stats.database.topTopics || [],
      canDownload: stats.system.canDownload,
      downloadRecommendation: stats.system.downloadRecommendation
    };
    
    console.log('Updated app state:', appState);
    
    // Update UI
    updateCrawlerStatsUI();
    
    return stats;
  } catch (error) {
    console.error('Failed to load crawler stats:', error);
    // Show error in UI
    if (elements.crawlerStatusText) {
      elements.crawlerStatusText.textContent = 'ERROR';
      elements.crawlerStatusIndicator.className = 'status-indicator status-offline';
    }
    return {};
  }
}

/**
 * Update crawler stats UI with enhanced information
 */
function updateCrawlerStatsUI() {
  const stats = appState.crawlerStats;
  const dbStats = appState.dbStats;
  
  // Update status indicator and text
  if (elements.crawlerStatusIndicator) {
    elements.crawlerStatusIndicator.className = `status-indicator status-${stats.isRunning ? 'online' : 'offline'}`;
  }
  
  if (elements.crawlerStatusText) {
    const statusText = stats.isRunning ? 'CRAWLING' : 
                      dbStats.storageProgress >= 100 ? 'STORAGE FULL' : 'STANDBY';
    elements.crawlerStatusText.textContent = statusText;
  }
  
  // Update individual stat elements
  if (elements.queueSize) {
    elements.queueSize.textContent = stats.queueSize.toLocaleString();
  }
  
  if (elements.processedUrls) {
    elements.processedUrls.textContent = dbStats.totalPages.toLocaleString();
  }
  
  if (elements.crawlSpeed) {
    elements.crawlSpeed.textContent = stats.crawlSpeed;
  }
  
  if (elements.crawlerRuntime) {
    elements.crawlerRuntime.textContent = formatDuration(stats.totalRuntime);
  }
  
  if (elements.dbSize) {
    elements.dbSize.textContent = dbStats.fileSize;
  }
  
  if (elements.dbSizePercent) {
    const progress = Math.min(Math.round(dbStats.storageProgress), 100);
    elements.dbSizePercent.textContent = `${progress}%`;
    
    // Add visual indication for storage levels
    const dbSizeElement = elements.dbSize.parentElement;
    if (dbSizeElement) {
      dbSizeElement.className = 'stat-card';
      if (progress >= 95) {
        dbSizeElement.className += ' storage-critical';
      } else if (progress >= 80) {
        dbSizeElement.className += ' storage-warning';
      }
    }
  }
  
  if (elements.successRate) {
    elements.successRate.textContent = `${stats.successRate}%`;
  }
  
  // Update download button based on database state and recommendation
  if (elements.downloadDbButton && dbStats.canDownload) {
    updateDownloadButtonState();
  }
  
  // Update last update timestamp
  const lastUpdateElement = document.getElementById('last-update');
  if (lastUpdateElement && dbStats.lastModified) {
    lastUpdateElement.textContent = new Date(dbStats.lastModified).toLocaleString();
  } else if (lastUpdateElement) {
    lastUpdateElement.textContent = 'Never';
  }
  
  // Update crawler mode panel
  updateCrawlerModePanel(stats.isRunning, dbStats.storageProgress);
}

/**
 * Update download button state based on database size and crawler status
 */
function updateDownloadButtonState() {
  if (!elements.downloadDbButton) return;
  
  const dbStats = appState.dbStats;
  const stats = appState.crawlerStats;
  
  // Change button text based on state
  let buttonText = 'DOWNLOAD DATABASE';
  let buttonClass = 'standalone-button';
  
  if (stats.isRunning) {
    buttonText = 'DOWNLOAD (LIVE)';
    buttonClass += ' download-live';
  }
  
  if (dbStats.downloadRecommendation === 'streaming') {
    buttonText += ' (LARGE)';
  }
  
  elements.downloadDbButton.textContent = buttonText;
  elements.downloadDbButton.className = buttonClass;
  
  // Add tooltip for large files
  if (dbStats.fileSizeBytes > 100 * 1024 * 1024) {
    elements.downloadDbButton.title = `Large file (${dbStats.fileSize}). Download may take time.`;
  }
}

/**
 * Enhanced download function with streaming support
 */
function initiateDownload() {
  const dbStats = appState.dbStats;
  const stats = appState.crawlerStats;
  
  if (!dbStats.canDownload) {
    alert('No database available for download.');
    return;
  }
  
  // Determine download method based on size and status
  const useStreaming = dbStats.downloadRecommendation === 'streaming' || 
                       dbStats.fileSizeBytes > 100 * 1024 * 1024;
  
  const downloadUrl = useStreaming ? '/api/download-db?stream=true' : '/api/download-db';
  
  // Show warning for active crawler
  if (stats.isRunning) {
    const proceed = confirm(
      `⚠️ CRAWLER IS ACTIVE\n\n` +
      `The crawler is currently running and the database is being updated. ` +
      `Downloading now may result in an incomplete snapshot.\n\n` +
      `Current size: ${dbStats.fileSize}\n` +
      `Last updated: ${dbStats.lastModified ? new Date(dbStats.lastModified).toLocaleString() : 'Unknown'}\n\n` +
      `Continue with download?`
    );
    
    if (!proceed) return;
  }
  
  // Show size warning for large files
  if (dbStats.fileSizeBytes > 500 * 1024 * 1024) { // > 500MB
    const proceed = confirm(
      `📁 LARGE FILE WARNING\n\n` +
      `Database size: ${dbStats.fileSize}\n` +
      `This is a large file and may take significant time to download.\n\n` +
      `Continue?`
    );
    
    if (!proceed) return;
  }
  
  // Start download
  console.log(`Starting download: ${downloadUrl}`);
  window.location.href = downloadUrl;
}

/**
 * Format seconds to a duration string (HH:MM:SS)
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
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
 * Perform search based on current query and selected topics
 */
async function performSearch() {
  if (!elements.searchInput || !elements.resultsList) return;
  
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

/**
 * Update the crawler mode panel based on crawler status and storage
 * @param {boolean} isActive - Whether the crawler is currently active
 * @param {number} storageProgress - Storage usage percentage
 */
function updateCrawlerModePanel(isActive, storageProgress = 0) {
  if (!elements.standalonePanel || !elements.standalonePanelTitle) return;
  
  let statusMessage = 'CRAWLER MODE STANDBY';
  let panelClass = 'standalone-panel';
  
  if (storageProgress >= 100) {
    statusMessage = '🚫 STORAGE LIMIT REACHED';
    panelClass += ' storage-full';
  } else if (isActive) {
    statusMessage = '⚡ CRAWLER MODE ACTIVE';
    panelClass += ' active';
  } else if (storageProgress >= 95) {
    statusMessage = '⚠️ STORAGE NEARLY FULL';
    panelClass += ' storage-warning';
  }
  
  elements.standalonePanel.className = panelClass;
  elements.standalonePanelTitle.textContent = statusMessage;
  
  // Update description based on status
  const descriptionElement = elements.standalonePanel.querySelector('.standalone-description');
  if (descriptionElement) {
    let description = '';
    
    if (storageProgress >= 100) {
      description = 'The database has reached the 10GB storage limit. The crawler has stopped to prevent system issues. Download the archive to access all collected knowledge.';
    } else if (isActive) {
      description = 'The crawler is actively archiving knowledge from the web. The database is continuously growing. You can download a snapshot at any time.';
    } else if (storageProgress >= 95) {
      description = 'The database is nearly full. The crawler will stop automatically when the 10GB limit is reached.';
    } else {
      description = 'The crawler is in standby mode. Knowledge archiving will resume automatically when new URLs are available.';
    }
    
    descriptionElement.textContent = description;
  }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp); 