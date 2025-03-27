/**
 * Content classifier for sorting web content into topics
 * Enhanced with extensive keyword sets for various knowledge domains
 */

// Extensive topic keywords organized by category
const topicKeywords = {
  // Survival & Emergency Preparedness
  survival: [
    'water purification', 'shelter building', 'fire starting', 'food preservation', 
    'emergency kit', 'first aid', 'disaster preparedness', 'bug out bag', 
    'survival skills', 'navigation', 'signaling', 'wilderness survival',
    'prepper', 'self-sufficiency', 'stockpiling', 'emergency shelter', 
    'survival gear', 'bushcraft', 'foraging', 'hunting', 'trapping', 
    'edible plants', 'medicinal plants', 'water collection', 'evacuation',
    'off-grid', 'shtf', 'teotwawki', 'disaster planning', 'crisis', 'sustainability',
    'solar power', 'ham radio', 'emergency communication', 'emergency lighting',
    'natural disaster', 'fallout', 'radiation', 'nuclear survival', 'bunker',
    'water storage', 'food rations', 'emergency heating', 'defense', 'homesteading'
  ],
  
  // Medicine & Healthcare
  medicine: [
    'treatment', 'disease', 'symptoms', 'diagnosis', 'cure', 'pharmacy', 
    'antibiotics', 'surgery', 'wound care', 'infection', 'emergency medicine',
    'trauma care', 'mental health', 'chronic illness', 'preventive medicine',
    'public health', 'epidemiology', 'virology', 'immunology', 'cardiology',
    'oncology', 'neurology', 'orthopedics', 'pediatrics', 'geriatrics',
    'pharmaceuticals', 'nursing', 'medical procedures', 'alternative medicine',
    'herbs', 'vaccination', 'pathology', 'anatomy', 'physiology', 'medical equipment',
    'first aid protocol', 'sutures', 'bandaging', 'cpr', 'resuscitation',
    'defibrillation', 'triage', 'vital signs', 'pharmacy compounding',
    'antiseptics', 'analgesics', 'antibiotics', 'burn treatment', 'pandemic'
  ],
  
  // Technology & Computing
  technology: [
    'computer', 'software', 'hardware', 'repair', 'electronics', 'circuit', 
    'solar', 'power generation', 'battery', 'radio', 'communication', 'internet',
    'programming', 'networking', 'cybersecurity', 'data storage', 'encryption',
    'artificial intelligence', 'machine learning', 'robotics', 'automation',
    'telecommunications', 'satellite', 'microcontroller', 'arduino', 'raspberry pi',
    'electrical engineering', 'mechanical engineering', 'fabrication', '3d printing',
    'renewable energy', 'hydropower', 'wind power', 'generators', 'inverters',
    'computer repair', 'server management', 'mesh networking', 'radio frequency',
    'microelectronics', 'embedded systems', 'solar panels', 'batteries', 'diy tech',
    'offline computing', 'analog technology', 'shortwave radio', 'amateur radio'
  ],
  
  // History & Civilization
  history: [
    'ancient', 'medieval', 'civilization', 'war', 'revolution', 'empire', 
    'dynasty', 'archaeology', 'cultural heritage', 'historical events',
    'world history', 'political history', 'economic history', 'social history',
    'military history', 'diplomatic history', 'religious history', 'art history',
    'prehistory', 'bronze age', 'iron age', 'classical era', 'renaissance',
    'industrial revolution', 'enlightenment', 'world war', 'cold war', 'colonialism',
    'imperialism', 'feudalism', 'monarchy', 'democracy', 'republic', 'dictatorship',
    'cultural revolution', 'genocide', 'historical documents', 'historical figures',
    'invention', 'discovery', 'exploration', 'migration', 'settlement',
    'societal collapse', 'dark age', 'historical reconstruction', 'historiography'
  ],
  
  // Science & Research
  science: [
    'physics', 'chemistry', 'biology', 'astronomy', 'geology', 'experiment', 
    'research', 'theory', 'scientific method', 'laboratory', 'hypothesis',
    'scientific discovery', 'scientific principles', 'environmental science',
    'oceanography', 'meteorology', 'climatology', 'botany', 'zoology', 'genetics',
    'molecular biology', 'biochemistry', 'organic chemistry', 'physical chemistry',
    'analytical chemistry', 'quantum physics', 'thermodynamics', 'mechanics',
    'optics', 'relativity', 'astrophysics', 'cosmology', 'particle physics',
    'earth science', 'geophysics', 'paleontology', 'microbiology', 'mycology',
    'ethology', 'ecology', 'evolution', 'taxonomy', 'scientific laws', 'constants',
    'measurements', 'scientific notation', 'mathematical formulas', 'scientific equipment'
  ],
  
  // Agriculture & Food Production
  agriculture: [
    'farming', 'crops', 'soil', 'irrigation', 'livestock', 'harvest', 'seeds',
    'permaculture', 'sustainable agriculture', 'organic farming', 'crop rotation',
    'companion planting', 'hydroponics', 'aquaponics', 'aeroponics', 'vertical farming',
    'greenhouse', 'horticulture', 'animal husbandry', 'beekeeping', 'poultry',
    'dairy farming', 'pest management', 'fertilizers', 'composting', 'soil conservation',
    'rainwater harvesting', 'drought resistance', 'seed saving', 'crop diversity',
    'food preservation', 'canning', 'dehydration', 'fermentation', 'smoking',
    'root cellar', 'food storage', 'grain storage', 'crop diseases', 'plant propagation',
    'grafting', 'pruning', 'seasonal planting', 'climate zones', 'agricultural tools'
  ],
  
  // Entertainment & Leisure
  entertainment: [
    'book', 'novel', 'story', 'fiction', 'movie', 'film', 'television', 'game', 
    'music', 'art', 'dance', 'theater', 'literature', 'poetry', 'comedy',
    'drama', 'folklore', 'mythology', 'legends', 'fairy tales', 'board games',
    'card games', 'sports', 'outdoor recreation', 'puzzles', 'crafts', 'hobbies',
    'musical instruments', 'singing', 'drawing', 'painting', 'sculpture', 'photography',
    'writing', 'storytelling', 'performance', 'festival', 'celebration', 'cultural events',
    'play', 'entertainment history', 'famous entertainers', 'directors', 'authors',
    'composers', 'artists', 'musicians', 'actors', 'recreational activities', 'leisure'
  ],
  
  // Engineering & Construction
  engineering: [
    'civil engineering', 'structural engineering', 'architecture', 'construction',
    'building materials', 'mechanical systems', 'structural integrity', 'blueprint',
    'design', 'infrastructure', 'load-bearing', 'foundation', 'framework', 'beams',
    'columns', 'trusses', 'concrete', 'steel', 'wood construction', 'masonry',
    'insulation', 'plumbing', 'electrical wiring', 'ventilation', 'heating',
    'cooling', 'roofing', 'walls', 'flooring', 'windows', 'doors', 'stairs',
    'bridges', 'roads', 'dams', 'tunnels', 'water systems', 'sewage systems',
    'waste management', 'recycling', 'building codes', 'safety standards',
    'drafting', 'surveying', 'site planning', 'demolition', 'renovation', 'restoration'
  ],
  
  // Philosophy & Ethics
  philosophy: [
    'ethics', 'morality', 'metaphysics', 'epistemology', 'logic', 'reasoning',
    'philosophy of science', 'philosophy of mind', 'political philosophy',
    'aesthetics', 'existentialism', 'nihilism', 'stoicism', 'utilitarianism',
    'deontology', 'virtue ethics', 'naturalism', 'idealism', 'materialism',
    'determinism', 'free will', 'consciousness', 'identity', 'knowledge',
    'truth', 'reality', 'existence', 'meaning', 'purpose', 'human nature',
    'philosophical arguments', 'thought experiments', 'philosophers', 'wisdom',
    'justice', 'rights', 'liberty', 'equality', 'social contract', 'natural law',
    'moral dilemmas', 'ethical principles', 'moral reasoning', 'critical thinking'
  ],
  
  // Mathematics & Logic
  mathematics: [
    'algebra', 'geometry', 'calculus', 'trigonometry', 'statistics', 'probability',
    'number theory', 'arithmetic', 'mathematical proof', 'theorem', 'equation',
    'formula', 'function', 'variable', 'constant', 'set theory', 'logic',
    'mathematical notation', 'mathematical symbols', 'matrix', 'vector',
    'differential equations', 'integral', 'derivative', 'limit', 'series',
    'geometric shapes', 'angles', 'lines', 'planes', 'curves', 'surfaces',
    'mathematical constants', 'pi', 'euler number', 'fibonacci', 'prime numbers',
    'fractions', 'decimals', 'percentages', 'logarithms', 'exponentials',
    'mathematical operations', 'mathematical properties', 'mathematical rules'
  ],
  
  // Language & Communication
  language: [
    'linguistics', 'grammar', 'syntax', 'semantics', 'phonology', 'morphology',
    'language family', 'dialect', 'accent', 'writing system', 'alphabet',
    'syllabary', 'ideographs', 'vocabulary', 'lexicon', 'dictionary',
    'thesaurus', 'etymology', 'translation', 'interpretation', 'language learning',
    'second language', 'multilingualism', 'communication theory', 'semiotics',
    'pragmatics', 'discourse', 'rhetoric', 'persuasion', 'debate', 'oratory',
    'public speaking', 'written communication', 'verbal communication',
    'nonverbal communication', 'sign language', 'braille', 'morse code',
    'codes', 'ciphers', 'cryptography', 'shorthand', 'languages of the world',
    'endangered languages', 'language preservation', 'language revival'
  ]
};

/**
 * Classify content based on keyword matching and frequency analysis
 * 
 * @param {string} title - The page title
 * @param {string} content - The page content
 * @param {number} threshold - Minimum score to include topic (default: 2)
 * @return {Object} Topic scores with confidence values
 */
function classifyContent(title, content, threshold = 2) {
  // Normalize content for better matching
  const normalizedText = `${title} ${content}`.toLowerCase();
  const scores = {};
  
  // Calculate score for each topic by counting keyword matches
  Object.entries(topicKeywords).forEach(([topic, keywords]) => {
    let topicScore = 0;
    
    // Keywords in title get higher weight
    const normalizedTitle = title.toLowerCase();
    
    // Process each keyword
    keywords.forEach(keyword => {
      // Get exact word matches for better accuracy
      const regex = new RegExp(`\\b${keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
      
      // Count matches in title (with higher weight)
      const titleMatches = (normalizedTitle.match(regex) || []).length;
      topicScore += titleMatches * 3;
      
      // Count matches in content
      const contentMatches = (normalizedText.match(regex) || []).length;
      topicScore += contentMatches;
    });
    
    // Only add topics that meet threshold
    if (topicScore >= threshold) {
      // Calculate confidence (0.0-1.0) based on keyword density
      // Normalize by text length and keyword count to avoid bias toward longer texts
      const wordCount = normalizedText.split(/\s+/).length;
      const normalizedScore = Math.min(1.0, (topicScore / Math.sqrt(wordCount)) * Math.sqrt(keywords.length / 10));
      
      scores[topic] = parseFloat(normalizedScore.toFixed(2));
    }
  });
  
  return scores;
}

/**
 * Get available topics for UI display
 * @returns {Array} List of all topic categories
 */
function getAvailableTopics() {
  return Object.keys(topicKeywords);
}

/**
 * Get keywords for a specific topic
 * @param {string} topic - Topic name
 * @returns {Array} List of keywords for the topic
 */
function getTopicKeywords(topic) {
  return topicKeywords[topic] || [];
}

module.exports = {
  classifyContent,
  getAvailableTopics,
  getTopicKeywords
}; 