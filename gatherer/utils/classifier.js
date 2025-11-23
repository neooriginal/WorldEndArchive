const stringSimilarity = require('string-similarity');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

class Classifier {
    constructor() {
        this.keywords = [];
        this.ignoredDomains = [];
        this.loadConfig();
    }

    loadConfig() {
        // Load Keywords
        const keywordsFile = process.env.KEYWORDS_FILE ? path.resolve(__dirname, '../', process.env.KEYWORDS_FILE) : path.resolve(__dirname, '../keywords.txt');
        try {
            if (fs.existsSync(keywordsFile)) {
                this.keywords = fs.readFileSync(keywordsFile, 'utf8')
                    .split('\n')
                    .map(k => k.trim().toLowerCase())
                    .filter(k => k.length > 0);
            }
        } catch (e) {
            console.error('Error loading keywords:', e.message);
        }

        // Load Ignored Domains
        const ignoredFile = process.env.IGNORED_DOMAINS_FILE ? path.resolve(__dirname, '../', process.env.IGNORED_DOMAINS_FILE) : path.resolve(__dirname, '../ignored_domains.txt');
        try {
            if (fs.existsSync(ignoredFile)) {
                this.ignoredDomains = fs.readFileSync(ignoredFile, 'utf8')
                    .split('\n')
                    .map(d => d.trim().toLowerCase())
                    .filter(d => d.length > 0);
            }
        } catch (e) {
            console.error('Error loading ignored domains:', e.message);
        }
    }

    isRelevant(text) {
        if (this.keywords.length === 0) return true; // If no keywords, assume all are relevant
        const lowerText = text.toLowerCase();
        return this.keywords.some(keyword => lowerText.includes(keyword));
    }

    isIgnored(url) {
        try {
            const hostname = new URL(url).hostname;
            return this.ignoredDomains.some(domain => hostname.endsWith(domain));
        } catch (e) {
            return false;
        }
    }

    isDuplicate(newText, existingTexts) {
        // existingTexts should be an array of strings to compare against.
        // CAUTION: Comparing against ALL existing texts is O(N) and slow.
        // For a large archive, we need a better approach (e.g., SimHash or MinHash).
        // Given the requirements and "minimal RAM", keeping all text in memory is bad.
        // We might need to rely on a rolling window or just check against the last N entries.

        if (!existingTexts || existingTexts.length === 0) return false;

        const threshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.8;

        // Optimization: Only check against texts of similar length (+/- 20%)
        const candidates = existingTexts.filter(t =>
            Math.abs(t.length - newText.length) / newText.length < 0.2
        );

        if (candidates.length === 0) return false;

        const bestMatch = stringSimilarity.findBestMatch(newText, candidates);
        return bestMatch.bestMatch.rating >= threshold;
    }
}

module.exports = new Classifier();
