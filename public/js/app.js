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
  stats: {}
};

// DOM Elements
let elements = {};

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
    loadStats()
  ]);
  
  // Initialize UI
  updateTopicsUI();
  updateStatsUI();
  
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
    systemStatus: document.getElementById('system-status')
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
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // ESC key to close content viewer
    if (e.key === 'Escape' && appState.currentView === 'content') {
      closeContentViewer();
    }
  });
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