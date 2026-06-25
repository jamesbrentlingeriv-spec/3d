// AI Chatbot Assistant with Client-Side RAG (Document Search) for 3D Eyewear Studio

class OpticalChatbot {
  constructor() {
    this.documents = [];
    this.apiKey = localStorage.getItem('openRouterApiKey') || '';
    this.model = localStorage.getItem('openRouterModel') || 'meta-llama/llama-3-8b-instruct:free';
    
    this.initElements();
    this.initEvents();
    this.loadDocuments();
    this.loadSavedSettings();
  }

  initElements() {
    this.toggleBtn = document.getElementById('chatbotToggleBtn');
    this.container = document.getElementById('chatbotContainer');
    this.closeBtn = document.getElementById('chatbotCloseBtn');
    this.settingsToggleBtn = document.getElementById('chatbotSettingsToggleBtn');
    this.settingsPanel = document.getElementById('chatbotSettingsPanel');
    this.keyInput = document.getElementById('openRouterKey');
    this.modelSelect = document.getElementById('chatbotModel');
    this.messagesContainer = document.getElementById('chatbotMessages');
    this.inputForm = document.getElementById('chatbotInputForm');
    this.inputText = document.getElementById('chatbotInputText');
    
    // Chathead avatar elements
    this.chatheadImg = document.getElementById('chatheadImg');
    this.chatheadVideo = document.getElementById('chatheadVideo');
  }

  initEvents() {
    // Open/Close chat window
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        this.container.classList.toggle('hidden');
        this.scrollToBottom();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.container.classList.add('hidden');
      });
    }

    // Toggle Settings panel
    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.addEventListener('click', () => {
        this.settingsPanel.classList.toggle('collapsed');
      });
    }

    // Save API key change
    if (this.keyInput) {
      this.keyInput.addEventListener('input', (e) => {
        this.apiKey = e.target.value.trim();
        localStorage.setItem('openRouterApiKey', this.apiKey);
      });
    }

    // Save Model change
    if (this.modelSelect) {
      this.modelSelect.addEventListener('change', (e) => {
        this.model = e.target.value;
        localStorage.setItem('openRouterModel', this.model);
      });
    }

    // Input form submit
    if (this.inputForm) {
      this.inputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleUserSubmit();
      });
    }

    // Quick reply chips
    document.querySelectorAll('.chat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query && this.inputText) {
          this.inputText.value = query;
          this.handleUserSubmit();
        }
      });
    });
  }

  loadSavedSettings() {
    if (this.keyInput) this.keyInput.value = this.apiKey;
    if (this.modelSelect) this.modelSelect.value = this.model;
  }

  async loadDocuments() {
    try {
      const response = await fetch('documents/manifest.json');
      if (!response.ok) throw new Error('Failed to load documents manifest');
      const manifest = await response.json();
      
      for (const filename of manifest.files) {
        try {
          const docRes = await fetch(`documents/${filename}`);
          if (docRes.ok) {
            const text = await docRes.text();
            this.documents.push({
              name: filename,
              content: text,
              paragraphs: this.splitIntoParagraphs(text)
            });
          }
        } catch (err) {
          console.warn(`[chatbot] Failed to fetch document: ${filename}`, err);
        }
      }
      console.log(`[chatbot] Loaded ${this.documents.length} knowledge base documents.`);
    } catch (err) {
      console.error('[chatbot] Error loading documents:', err);
    }
  }

  splitIntoParagraphs(text) {
    // Splits by double newline, filtering out empty blocks
    return text.split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 10 && !p.startsWith('#'));
  }

  // Basic client-side keyword search (RAG)
  searchDocuments(query) {
    if (this.documents.length === 0) return '';
    
    // Stop words to filter out of search query
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'at', 'on', 'for', 'with', 'about', 'how', 'what', 'you', 'me', 'i']);
    const keywords = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
      
    if (keywords.length === 0) return '';
    
    const matches = [];
    
    this.documents.forEach(doc => {
      doc.paragraphs.forEach(paragraph => {
        let score = 0;
        const lowerPara = paragraph.toLowerCase();
        
        keywords.forEach(keyword => {
          if (lowerPara.includes(keyword)) {
            // Award points for keyword presence, and extra points for multiple occurrences
            const regex = new RegExp(keyword, 'g');
            const count = (lowerPara.match(regex) || []).length;
            score += count;
          }
        });
        
        if (score > 0) {
          matches.push({ paragraph, score });
        }
      });
    });
    
    // Sort by relevance score desc and return the top 4 matching paragraphs
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 4).map(m => m.paragraph).join('\n\n');
  }

  async handleUserSubmit() {
    const text = this.inputText.value.trim();
    if (!text) return;
    
    // Add user message to UI
    this.addMessage(text, 'user');
    this.inputText.value = '';
    
    // Show typing placeholder
    const typingBubble = this.addTypingIndicator();
    this.scrollToBottom();
    
    // Toggle chathead to video (playing)
    this.setAIResponding(true);
    
    // Get search context (RAG)
    const context = this.searchDocuments(text);
    
    try {
      const responseText = await this.callOpenRouter(text, context);
      this.removeTypingIndicator(typingBubble);
      this.addMessage(responseText, 'bot');
    } catch (err) {
      console.error('[chatbot] API Error:', err);
      this.removeTypingIndicator(typingBubble);
      this.addMessage(`I encountered an issue connecting to the AI service. Please make sure you have entered a valid **OpenRouter API Key** in the settings panel at the top of this chat. Or call us directly at **(859) 266-3003**!`, 'bot');
    } finally {
      this.setAIResponding(false);
      this.scrollToBottom();
    }
  }

  setAIResponding(isResponding) {
    if (!this.chatheadImg || !this.chatheadVideo) return;
    
    if (isResponding) {
      this.chatheadImg.classList.add('hidden');
      this.chatheadVideo.classList.remove('hidden');
      this.chatheadVideo.play().catch(err => console.log('Video play failed:', err));
    } else {
      this.chatheadVideo.pause();
      this.chatheadVideo.classList.add('hidden');
      this.chatheadImg.classList.remove('hidden');
    }
  }

  async callOpenRouter(userMessage, context) {
    // Fallback prompt guidance if no API key is set
    if (!this.apiKey) {
      throw new Error('API key is missing');
    }
    
    const systemPrompt = `You are the Pal Optical AI Assistant, a friendly and helpful virtual representative for Pal Optical located in Lexington, KY.
Your goal is to assist customers with questions about Pal Optical, lens upgrades, frame models, eye exams, and contact lens orders.

Here is some background information about Pal Optical retrieved from our official documents:
${context || 'No specific document context found. Answer using general knowledge about Pal Optical.'}

General Guidelines:
1. Always be polite, professional, and helpful.
2. When discussing store information, always quote the correct phone numbers, fax numbers, hours (Mon-Sat 9am-6pm), and services (such as the on-site lab which does most jobs, or the Doctor's office next door with Dr. Klecker O.D. and Dr. Robbins O.D. at 859-269-6921).
3. If the user asks to look at more frame models that aren't on the app, provide links to:
   - Modern frames: https://www.modernoptical.com
   - Shaquille O'Neal frames: https://www.zyloware.com
   - Enhance frames: https://www.newyorkeye.net
   - Smilen frames: https://www.smileneyewear.com
   - bebe, Calvin Klein Jeans, etc.: https://www.altaireyewear.com
4. Provide a clickable link to the main Pal Optical website: https://www.pal-optical.com.
5. If the user asks about lenses, explain single vision, bifocal, progressive (no-line bifocal) lenses, and materials/upgrades like Polycarbonate, High-Index, Anti-Reflective coatings, Blue-Light filtering, and Transitions (photochromic) lenses.
6. Keep your answers concise, clean, and format them nicely with Markdown (bold text, bullet points).
7. If the user asks something completely unrelated to optics or the store, politely bring them back to optical questions, but you can also answer general questions if they use the web search feature.

Note: Answer based on the retrieved context whenever possible. If you don't know the answer, politely tell them they can call the store at (859) 266-3003.`;

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': '3D Eyewear Studio'
    };

    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: headers,
      body: body
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  addMessage(text, sender) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${sender}`;
    
    // Parse basic markdown-like syntax for bold text and links
    let formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: #00ffcc; text-decoration: underline;">$1</a>');
      
    // Convert newlines to breaks
    formattedText = formattedText.replace(/\n/g, '<br>');
    
    bubble.innerHTML = formattedText;
    this.messagesContainer.appendChild(bubble);
    this.scrollToBottom();
  }

  addTypingIndicator() {
    const bubble = document.createElement('div');
    bubble.className = 'chat-message bot typing';
    bubble.innerHTML = 'Thinking<span></span><span></span><span></span>';
    this.messagesContainer.appendChild(bubble);
    return bubble;
  }

  removeTypingIndicator(bubble) {
    if (bubble && bubble.parentNode) {
      bubble.parentNode.removeChild(bubble);
    }
  }

  scrollToBottom() {
    if (this.messagesContainer) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }
}

// Initialize Chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.opticalChatbot = new OpticalChatbot();
});
