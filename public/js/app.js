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
      
      // Check if database exists and has size
      if (!appState.dbStats.fileSizeBytes) {
        alert('No database available for download.');
        return;
      }
      
      const dbSizeStr = elements.dbSize.textContent;
      let shouldProceed = true;
      
      // Size warning for large downloads
      if (appState.dbStats.fileSizeBytes > 100 * 1024 * 1024) {
        shouldProceed = confirm(`Database size is ${dbSizeStr}. Download may take some time. Continue?`);
      }
      
      if (shouldProceed) {
        // Show downloading status
        const originalText = elements.downloadDbButton.textContent;
        elements.downloadDbButton.textContent = 'DOWNLOADING...';
        elements.downloadDbButton.classList.add('downloading');
        elements.downloadDbButton.disabled = true;
        
        // Create a fetch request to check headers first
        fetch('/api/download-db', { method: 'HEAD' })
          .then(response => {
            // Check for crawler active warning
            if (response.headers.get('X-Crawler-Active') === 'true') {
              const warningAcknowledged = confirm('WARNING: Crawler is currently active. Downloading the database while crawling is in progress might result in a corrupted file. Continue anyway?');
              if (!warningAcknowledged) {
                throw new Error('Download canceled by user');
              }
            }
            
            // Get file size from headers
            const contentLength = response.headers.get('Content-Length');
            const fileSize = parseInt(contentLength);
            
            // Create progress bar
            const progressBar = document.createElement('div');
            progressBar.className = 'download-progress';
            progressBar.innerHTML = `
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            `;
            elements.downloadDbButton.parentNode.appendChild(progressBar);
            
            // Start download with progress tracking
            return fetch('/api/download-db')
              .then(response => {
                const reader = response.body.getReader();
                const contentLength = +response.headers.get('Content-Length');
                let receivedLength = 0;
                const chunks = [];
                
                return new ReadableStream({
                  start(controller) {
                    function push() {
                      reader.read().then(({done, value}) => {
                        if (done) {
                          controller.close();
                          return;
                        }
                        chunks.push(value);
                        receivedLength += value.length;
                        
                        // Update progress
                        const progress = (receivedLength / contentLength) * 100;
                        progressBar.querySelector('.progress-fill').style.width = `${progress}%`;
                        progressBar.querySelector('.progress-text').textContent = `${Math.round(progress)}%`;
                        
                        controller.enqueue(value);
                        push();
                      });
                    }
                    push();
                  }
                });
              })
              .then(stream => {
                return new Response(stream);
              })
              .then(response => response.blob())
              .then(blob => {
                // Create download link
                const url = URL.createObjectURL(blob);
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = 'worldend_archive.json';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(url);
                
                // Remove progress bar after a short delay
                setTimeout(() => {
                  if (progressBar.parentNode) {
                    progressBar.parentNode.removeChild(progressBar);
                  }
                }, 1000);
              });
          })
          .catch(error => {
            console.error('Download preparation failed:', error);
            alert(`Download failed: ${error.message}`);
          })
          .finally(() => {
            // Reset button state
            elements.downloadDbButton.textContent = originalText;
            elements.downloadDbButton.classList.remove('downloading');
            elements.downloadDbButton.disabled = false;
          });
      }
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
 * Load crawler stats from API
 */
async function loadCrawlerStats() {
  try {
    console.log('Fetching crawler stats...');
    const response = await fetch('/api/crawler-stats');
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    const stats = await response.json();
    console.log('Received stats:', stats);
    
    // Update application state
    appState.crawlerStats = stats.crawler 
    appState.dbStats = stats.database
    
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
 * Update crawler stats UI
 */
function updateCrawlerStatsUI() {
  const stats = appState.crawlerStats;
  const dbStats = appState.dbStats;
  
  // Update status indicator and text
  if (elements.crawlerStatusIndicator) {
    elements.crawlerStatusIndicator.className = `status-indicator status-${stats.isRunning ? 'online' : 'offline'}`;
  }
  
  if (elements.crawlerStatusText) {
    elements.crawlerStatusText.textContent = stats.isRunning ? 'ONLINE' : 'OFFLINE';
  }
  
  // Update individual stat elements
  if (elements.queueSize) {
    elements.queueSize.textContent = stats.queueSize;
  }
  
  if (elements.processedUrls) {
    elements.processedUrls.textContent = dbStats.totalPages;
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
  
  if (elements.dbSizePercent && stats.maxDbSize > 0) {
    const progress = (dbStats.fileSizeBytes / stats.maxDbSize) * 100;
    elements.dbSizePercent.textContent = `${Math.min(Math.round(progress), 100)}%`;
  }
  
  if (elements.successRate) {
    elements.successRate.textContent = `${stats.successRate}%`;
  }
  
  // Update crawler mode panel
  updateCrawlerModePanel(stats.isRunning);
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
 * Update the crawler mode panel based on crawler status
 * @param {boolean} isActive - Whether the crawler is currently active
 */
function updateCrawlerModePanel(isActive) {
  if (!elements.standalonePanel || !elements.standalonePanelTitle) return;
  
  if (isActive) {
    elements.standalonePanel.classList.add('active');
    elements.standalonePanelTitle.innerHTML = '⚠️ ATTENTION: CRAWLER MODE ACTIVE ⚠️';
    
    // Add a warning icon if not present
    if (!document.querySelector('.crawler-mode-icon')) {
      const warningIcon = document.createElement('div');
      warningIcon.className = 'crawler-mode-icon';
      warningIcon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      elements.standalonePanelTitle.prepend(warningIcon);
    }
  } else {
    elements.standalonePanel.classList.remove('active');
    elements.standalonePanelTitle.innerHTML = 'CRAWLER MODE STANDBY';
    
    // Remove any existing warning icon
    const warningIcon = document.querySelector('.crawler-mode-icon');
    if (warningIcon) {
      warningIcon.remove();
    }
  }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp); 