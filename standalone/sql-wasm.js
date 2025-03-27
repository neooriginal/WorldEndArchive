/**
 * SQL.js for WorldEndArchive standalone version
 * Lightweight wrapper for bootstrapping SQL.js
 */

(function() {
  // The SQL.js object needs to be created
  window.initSqlJs = async function(config) {
    // This will be replaced with the actual SQL.js implementation
    return {
      Database: function(data) {
        this.data = data;
        
        // Basic stub for searching
        this.exec = function(sql) {
          console.log('SQL query:', sql);
          
          // Very basic query parsing to handle the simplest cases
          if (sql.trim().toUpperCase().startsWith('SELECT COUNT(*) AS COUNT FROM PAGES')) {
            return [{
              columns: ['count'],
              values: [[localStorage.getItem('totalPages') || 0]]
            }];
          }
          
          if (sql.trim().toUpperCase().startsWith('SELECT KEY, VALUE FROM SETTINGS')) {
            return [{
              columns: ['key', 'value'],
              values: [
                ['last_crawl_date', localStorage.getItem('lastCrawlDate') || new Date().toISOString()],
                ['total_pages', localStorage.getItem('totalPages') || '0'],
                ['total_size_raw', localStorage.getItem('totalSizeRaw') || '0'],
                ['total_size_compressed', localStorage.getItem('totalSizeCompressed') || '0']
              ]
            }];
          }
          
          if (sql.trim().toUpperCase().startsWith('SELECT DISTINCT TOPIC FROM PAGE_TOPICS')) {
            const topics = localStorage.getItem('topics') ? 
              JSON.parse(localStorage.getItem('topics')) : 
              ['science', 'technology', 'medicine', 'history', 'literature'];
              
            return [{
              columns: ['topic'],
              values: topics.map(t => [t])
            }];
          }
          
          // For all other queries, return empty results
          return [];
        };
        
        this.prepare = function(sql) {
          return {
            bind: function(params) {},
            step: function() { return false; },
            getAsObject: function() { return {}; }
          };
        };
        
        this.close = function() {};
      }
    };
  };
  
  // Try to load the full SQL.js if possible
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js';
  document.head.appendChild(script);
  
  // Store some basic placeholder data
  localStorage.setItem('totalPages', '0');
  localStorage.setItem('lastCrawlDate', new Date().toISOString());
  localStorage.setItem('topics', JSON.stringify(['science', 'technology', 'medicine', 'history', 'literature']));
})(); 