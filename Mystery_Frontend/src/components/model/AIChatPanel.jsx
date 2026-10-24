'use client';

import { useState } from 'react';
import { X, Send, Sparkles } from 'lucide-react';

/**
 * AIChatPanel component
 * Implements the AI Chat Panel (Right Contextual Panel) from the Design System
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the panel is open
 * @param {Function} props.onClose - Callback when panel is closed
 * @param {Function} [props.onSendMessage] - Callback when a message is sent
 */
export function AIChatPanel({ isOpen, onClose, onSendMessage }) {
  const [messages, setMessages] = useState([
    {
      id: 'initial',
      type: 'ai',
      text: 'Hello! I can help you model your business process. Describe your process and I\'ll create a BPMN diagram for you.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      text: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Call external handler
    onSendMessage?.(input);

    // Simulate AI response (replace with actual API call)
    setTimeout(() => {
      const aiMessage = {
        id: `ai-${Date.now()}`,
        type: 'ai',
        text: 'I received your message. Processing your process description...',
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1000);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="w-80 border-l border-gray-200 bg-white overflow-hidden flex flex-col">
      {/* Header with Gradient */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Model Process Using AI</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white transition-colors text-gray-600"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                message.type === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-600 rounded-lg px-4 py-2 text-sm">
              <div className="flex gap-1">
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-200 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Describe your process..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          onClick={handleSendMessage}
          disabled={!input.trim() || isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
