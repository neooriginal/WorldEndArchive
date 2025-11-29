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

    isLowQualityUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            const search = urlObj.search.toLowerCase();

            // Tracking pixels and analytics
            if (pathname.includes('/pixel') || pathname.includes('/track') || pathname.includes('/beacon')) {
                return true;
            }

            // Social sharing and action URLs
            if (pathname.includes('/share') || pathname.includes('/print') ||
                pathname.includes('/email') || pathname.includes('/download.pdf')) {
                return true;
            }

            // Login/logout/register pages
            if (pathname.match(/\/(login|logout|signin|signout|register|signup|auth)/)) {
                return true;
            }

            // Deep pagination (>10 pages)
            const pageMatch = pathname.match(/\/page\/(\d+)/) || search.match(/[?&]page=(\d+)/);
            if (pageMatch && parseInt(pageMatch[1]) > 10) {
                return true;
            }

            // Very long URLs
            if (url.length > 500) {
                return true;
            }

            // Too many query parameters
            const paramCount = (search.match(/&/g) || []).length + (search.includes('?') ? 1 : 0);
            if (paramCount > 8) {
                return true;
            }

            // Non-HTML file types
            if (pathname.match(/\.(xml|json|rss|atom|ics|vcf|zip|tar|gz|exe|dmg|pkg)$/)) {
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    isDuplicate(newText, existingTexts) {
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
