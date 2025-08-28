import React, { useState } from 'react';
import './AdminSessionCreation.css';

interface SessionData {
  subject: string;
  tutor_name: string;
  student_name: string;
}

interface SessionResponse {
  success: boolean;
  session: {
    id: number;
    subject: string;
    tutor_name: string;
    student_name: string;
    created_at: string;
  };
  urls: {
    tutor: string;
    student: string;
    moderator: string;
  };
  message: string;
}

const AdminSessionCreation: React.FC = () => {
  const [formData, setFormData] = useState<SessionData>({
    subject: '',
    tutor_name: '',
    student_name: ''
  });
  const [loading, setLoading] = useState(false);
  const [sessionResult, setSessionResult] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSessionResult(null);

    try {
      const response = await fetch('https://class.moalimy.com/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setSessionResult(data);
        setFormData({ subject: '', tutor_name: '', student_name: '' });
      } else {
        setError(data.message || 'Failed to create session');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="admin-session-creation">
      <div className="container">
        <h1>Create Virtual Classroom Session</h1>
        
        <form onSubmit={handleSubmit} className="session-form">
          <div className="form-group">
            <label htmlFor="subject">Class Subject</label>
            <input
              type="text"
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleInputChange}
              required
              placeholder="e.g., Mathematics, Science, English"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tutor_name">Tutor Name</label>
            <input
              type="text"
              id="tutor_name"
              name="tutor_name"
              value={formData.tutor_name}
              onChange={handleInputChange}
              required
              placeholder="Enter tutor's name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="student_name">Student Name</label>
            <input
              type="text"
              id="student_name"
              name="student_name"
              value={formData.student_name}
              onChange={handleInputChange}
              required
              placeholder="Enter student's name"
            />
          </div>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Creating Session...' : 'Create Session'}
          </button>
        </form>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {sessionResult && (
          <div className="session-result">
            <h2>Session Created Successfully!</h2>
            <div className="session-info">
              <p><strong>Subject:</strong> {sessionResult.session.subject}</p>
              <p><strong>Tutor:</strong> {sessionResult.session.tutor_name}</p>
              <p><strong>Student:</strong> {sessionResult.session.student_name}</p>
              <p><strong>Session ID:</strong> {sessionResult.session.id}</p>
            </div>

            <div className="role-urls">
              <h3>Role-based URLs:</h3>
              
              <div className="url-item">
                <label>Tutor URL:</label>
                <div className="url-display">
                  <input 
                    type="text" 
                    value={sessionResult.urls.tutor} 
                    readOnly 
                  />
                  <button 
                    onClick={() => copyToClipboard(sessionResult.urls.tutor)}
                    className="copy-btn"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="url-item">
                <label>Student URL:</label>
                <div className="url-display">
                  <input 
                    type="text" 
                    value={sessionResult.urls.student} 
                    readOnly 
                  />
                  <button 
                    onClick={() => copyToClipboard(sessionResult.urls.student)}
                    className="copy-btn"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="url-item">
                <label>Moderator URL:</label>
                <div className="url-display">
                  <input 
                    type="text" 
                    value={sessionResult.urls.moderator} 
                    readOnly 
                  />
                  <button 
                    onClick={() => copyToClipboard(sessionResult.urls.moderator)}
                    className="copy-btn"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="instructions">
              <h4>Instructions:</h4>
              <ul>
                <li>Share the appropriate URL with each participant</li>
                <li>Tutors can upload files and control the whiteboard</li>
                <li>Students can view and annotate on the whiteboard</li>
                <li>Moderators have full control over the session</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSessionCreation;
