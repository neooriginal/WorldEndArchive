document.addEventListener('DOMContentLoaded', () => {
    const pagesCount = document.getElementById('pages-count');
    const queueLength = document.getElementById('queue-length');
    const txtSize = document.getElementById('txt-size');
    const uptime = document.getElementById('uptime');
    const urlInput = document.getElementById('url-input');
    const addBtn = document.getElementById('add-btn');
    const logContainer = document.getElementById('log-container');

    function updateStats() {
        fetch('/stats')
            .then(res => res.json())
            .then(data => {
                pagesCount.textContent = data.storage.count;
                queueLength.textContent = data.crawler.queueLength;
                txtSize.textContent = (data.storage.txtSize / (1024 * 1024)).toFixed(2) + ' MB';
                document.getElementById('db-size').textContent = (data.storage.dbSize / (1024 * 1024)).toFixed(2) + ' MB';
                uptime.textContent = Math.floor(data.uptime) + 's';
            })
            .catch(err => console.error('Error fetching stats:', err));
    }

    function addLog(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg">${message}</span>`;
        logContainer.prepend(entry);

        // Keep only last 50 logs to prevent DOM bloat
        if (logContainer.children.length > 50) {
            logContainer.lastChild.remove();
        }
    }

    // Connect to SSE Log Stream
    const logSource = new EventSource('/logs/stream');
    logSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        addLog(data.message, data.level);
    };

    logSource.onerror = () => {
        console.log('SSE connection lost, retrying...');
        logSource.close();
        setTimeout(() => {
            new EventSource('/logs/stream'); // Simple retry
        }, 5000);
    };

    addBtn.addEventListener('click', () => {
        const url = urlInput.value;
        if (!url) return;

        fetch('/add-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    addLog(`Added URL: ${url}`);
                    urlInput.value = '';
                    updateStats();
                } else {
                    alert(data.error);
                }
            })
            .catch(err => alert('Error adding URL'));
    });

    // Update stats every 2 seconds
    setInterval(updateStats, 2000);
    updateStats();
});
