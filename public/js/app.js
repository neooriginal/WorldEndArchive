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
            
            // Proceed with download
            const downloadLink = document.createElement('a');
            downloadLink.href = '/api/download-db';
            downloadLink.download = 'worldend_archive.db';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            // Monitor download progress
            const downloadCheckInterval = setInterval(() => {
              // After 3 seconds, assume download has started and reset button
              setTimeout(() => {
                clearInterval(downloadCheckInterval);
                elements.downloadDbButton.textContent = originalText;
                elements.downloadDbButton.classList.remove('downloading');
                elements.downloadDbButton.disabled = false;
              }, 3000);
            }, 500);
          })
          .catch(error => {
            console.error('Download preparation failed:', error);
            alert(`Download failed: ${error.message}`);
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
    appState.crawlerStats = stats.crawler || {
      isRunning: false,
      queueSize: 0,
      processedUrls: 0,
      crawlSpeed: 0,
      runtime: 0,
      successRate: 100,
      lastProcessedUrl: null
    };
    appState.dbStats = stats.database || {
      fileSize: '0 B',
      fileSizeBytes: 0,
      totalPages: 0,
      totalSizeRaw: '0 B',
      totalSizeCompressed: '0 B',
      compressionRatio: '0:0',
      topTopics: []
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
 * Update crawler stats UI
 */
function updateCrawlerStatsUI() {
  const { crawlerStats, dbStats } = appState;
  
  // Crawler status indicator
  if (elements.crawlerStatusIndicator && elements.crawlerStatusText) {
    if (crawlerStats && crawlerStats.isRunning) {
      elements.crawlerStatusIndicator.className = 'status-indicator status-online';
      elements.crawlerStatusText.textContent = 'ACTIVE';
    } else if (dbStats && dbStats.queueStatus && dbStats.queueStatus.in_progress > 0) {
      // Backup check - if there are URLs in progress, show as active even if isRunning is false
      elements.crawlerStatusIndicator.className = 'status-indicator status-online';
      elements.crawlerStatusText.textContent = 'ACTIVE';
    } else {
      elements.crawlerStatusIndicator.className = 'status-indicator status-offline';
      elements.crawlerStatusText.textContent = 'IDLE';
    }
    
    // Update standalone panel with crawler status
    updateCrawlerModePanel(crawlerStats.isRunning || (dbStats && dbStats.queueStatus && dbStats.queueStatus.in_progress > 0));
  }
  
  // Database size
  if (elements.dbSize && dbStats) {
    elements.dbSize.textContent = dbStats.fileSize || '0 B';
  }
  
  // Database size percentage
  if (elements.dbSizePercent && dbStats) {
    const fileSizeBytes = dbStats.fileSizeBytes || 0;
    const percentFilled = Math.min(100, Math.round((fileSizeBytes / MAX_DB_SIZE_BYTES) * 100));
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
    
    // Update ETA to max storage if we have active crawling
    if (crawlerStats && dbStats && dbStats.totalPages > 0) {
      updateStorageETA(fileSizeBytes, crawlerStats.crawlSpeed);
    }
  }
  
  // Crawl speed
  if (elements.crawlSpeed && crawlerStats) {
    elements.crawlSpeed.textContent = crawlerStats.crawlSpeed || '0';
  }
  
  // Queue size
  if (elements.queueSize && crawlerStats) {
    let queueTotal = crawlerStats.queueSize || 0;
    
    // Use database queue stats if available
    if (dbStats && dbStats.queueStatus) {
      queueTotal = (dbStats.queueStatus.pending || 0) + (dbStats.queueStatus.in_progress || 0);
    }
    
    elements.queueSize.textContent = queueTotal;
  }
  
  // Processed URLs
  if (elements.processedUrls && crawlerStats) {
    // Use crawler stats or database stats for processed URLs
    const processedCount = crawlerStats.processedUrls || 0;
    
    // If database has total pages info, prefer that
    if (dbStats && dbStats.totalPages) {
      elements.processedUrls.textContent = dbStats.totalPages;
    } else {
      elements.processedUrls.textContent = processedCount;
    }
  }
  
  // Runtime
  if (elements.crawlerRuntime && crawlerStats) {
    let runtime = crawlerStats.runtime || 0;
    
    // If we have totalRuntime from the server, use it
    if (crawlerStats.totalRuntime) {
      runtime = crawlerStats.totalRuntime;
      
      // If crawler is running and has a start time, add the time since it started
      if (crawlerStats.isRunning && crawlerStats.startTime) {
        const startTimeMs = new Date(crawlerStats.startTime).getTime();
        const elapsedSinceStart = Math.floor((Date.now() - startTimeMs) / 1000);
        runtime += elapsedSinceStart;
      }
    }
    
    elements.crawlerRuntime.textContent = formatTime(runtime);
  }
  
  // Success rate
  if (elements.successRate && crawlerStats) {
    elements.successRate.textContent = `${crawlerStats.successRate || 100}%`;
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
  if (!elements.contentViewer) return;
  
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

/**
 * Calculate and update ETA to reach maximum storage capacity
 * @param {number} currentSizeBytes - Current database size in bytes
 * @param {number} crawlSpeed - Current crawl speed in pages per minute
 */
function updateStorageETA(currentSizeBytes, crawlSpeed) {
  let etaElement = document.getElementById('storage-eta');
  if (!etaElement) {
    // Create ETA element if it doesn't exist
    etaElement = document.createElement('div');
    etaElement.id = 'storage-eta';
    etaElement.className = 'stat-subtitle';
    
    // Add after db percentage
    const dbSizeElement = document.getElementById('db-size');
    if (dbSizeElement && dbSizeElement.parentNode) {
      dbSizeElement.parentNode.appendChild(etaElement);
    }
  }
  
  // If crawl speed is 0 or too low, can't calculate ETA
  if (!crawlSpeed || crawlSpeed < 0.1) {
    etaElement.textContent = 'ETA: N/A at current speed';
    return;
  }
  
  // Calculate remaining bytes
  const remainingBytes = MAX_DB_SIZE_BYTES - currentSizeBytes;
  
  // If already at max, show 100%
  if (remainingBytes <= 0) {
    etaElement.textContent = 'Storage limit reached';
    return;
  }
  
  // Calculate average bytes per page based on current data
  const averageBytesPerPage = currentSizeBytes / appState.dbStats.totalPages;
  
  if (!averageBytesPerPage || isNaN(averageBytesPerPage)) {
    etaElement.textContent = 'ETA: Calculating...';
    return;
  }
  
  // Calculate how many more pages until max
  const remainingPages = remainingBytes / averageBytesPerPage;
  
  // Calculate time in minutes
  const minutesRemaining = remainingPages / crawlSpeed;
  
  // Format the ETA
  if (minutesRemaining < 60) {
    etaElement.textContent = `ETA: ~${Math.ceil(minutesRemaining)} minutes to capacity`;
  } else if (minutesRemaining < 24 * 60) {
    const hours = Math.ceil(minutesRemaining / 60);
    etaElement.textContent = `ETA: ~${hours} hours to capacity`;
  } else {
    const days = Math.ceil(minutesRemaining / (24 * 60));
    etaElement.textContent = `ETA: ~${days} days to capacity`;
  }
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