import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export default function DefectTrackApp() {
  // Auth states
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // App states
  const [currentView, setCurrentView] = useState('list'); // 'list', 'create', 'detail'
  const [defects, setDefects] = useState([]);
  const [selectedDefect, setSelectedDefect] = useState(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');

  // Form states
  const [formData, setFormData] = useState({
    location: '',
    issue_description: '',
    priority: 'Medium',
  });
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Initialize auth and load data
  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setUser(data.session.user);
        await loadDefects();
        await loadUsers();
      }
    };
    checkAuth();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUser(session.user);
      } else {
        setUser(null);
      }
    });

    return () => data?.subscription?.unsubscribe();
  }, []);

  // Load defects
  const loadDefects = async () => {
    try {
      const { data, error } = await supabase
        .from('defects')
        .select(`
          *,
          reported_by:users!reported_by(email, full_name),
          assigned_to_user:users!assigned_to(email, full_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDefects(data || []);
    } catch (err) {
      console.error('Error loading defects:', err);
    }
  };

  // Load users for assignment
  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name')
        .eq('role', 'defect_owner');

      if (error) throw error;
      setAllUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setAuthError(error.message);
      } else {
        setEmail('');
        setPassword('');
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle signup
  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);

    try {
      const { error: signupError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signupError) {
        setAuthError(signupError.message);
      } else {
        setAuthError('');
        // Auto sign in after signup
        await supabase.auth.signInWithPassword({ email, password });
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // Create defect
  const handleCreateDefect = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('defects')
        .insert([{
          location: formData.location,
          issue_description: formData.issue_description,
          priority: formData.priority,
          reported_by: user.id,
          status: 'Open',
        }])
        .select();

      if (error) throw error;

      // Upload files
      if (files.length > 0 && data[0]) {
        const defectId = data[0].id;
        for (const file of files) {
          const filePath = `${defectId}/${Date.now()}-${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from('defect-attachments')
            .upload(filePath, file);

          if (!uploadError) {
            await supabase.from('defect_attachments').insert([{
              defect_id: defectId,
              file_name: file.name,
              file_type: file.type.includes('pdf') ? 'pdf' : 'photo',
              file_path: filePath,
              file_size: file.size,
              uploaded_by: user.id,
            }]);
          }
        }
      }

      // Add initial note
      if (data[0]) {
        await supabase.from('defect_notes').insert([{
          defect_id: data[0].id,
          note_text: formData.issue_description,
          created_by: user.id,
          status_change: 'Open',
        }]);
      }

      // Reset form and reload
      setFormData({ location: '', issue_description: '', priority: 'Medium' });
      setFiles([]);
      await loadDefects();
      setCurrentView('list');
    } catch (err) {
      setAuthError('Error creating defect: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Assign defect
  const handleAssignDefect = async () => {
    if (!assignedTo) {
      setAuthError('Please select someone to assign to');
      return;
    }

    try {
      const { error } = await supabase
        .from('defects')
        .update({
          assigned_to: assignedTo,
          status: 'Assigned',
          assigned_date: new Date().toISOString(),
        })
        .eq('id', selectedDefect.id);

      if (error) throw error;

      await supabase.from('defect_notes').insert([{
        defect_id: selectedDefect.id,
        note_text: `Assigned to ${allUsers.find(u => u.id === assignedTo)?.email || 'Unknown'}`,
        created_by: user.id,
        status_change: 'Assigned',
      }]);

      await loadDefects();
      setAssignedTo('');
    } catch (err) {
      setAuthError('Error assigning defect: ' + err.message);
    }
  };

  // Close defect
  const handleCloseDefect = async () => {
    if (!rootCause) {
      setAuthError('Please provide root cause');
      return;
    }

    try {
      const { error } = await supabase
        .from('defects')
        .update({
          status: 'Closed',
          closed_date: new Date().toISOString(),
          root_cause: rootCause,
        })
        .eq('id', selectedDefect.id);

      if (error) throw error;

      await supabase.from('defect_notes').insert([{
        defect_id: selectedDefect.id,
        note_text: `Closed - Root Cause: ${rootCause}`,
        created_by: user.id,
        status_change: 'Closed',
      }]);

      if (notes) {
        await supabase.from('defect_notes').insert([{
          defect_id: selectedDefect.id,
          note_text: notes,
          created_by: user.id,
        }]);
      }

      await loadDefects();
      setRootCause('');
      setNotes('');
      setCurrentView('list');
    } catch (err) {
      setAuthError('Error closing defect: ' + err.message);
    }
  };

  // Add note to defect
  const handleAddNote = async () => {
    if (!notes.trim()) return;

    try {
      const { error } = await supabase.from('defect_notes').insert([{
        defect_id: selectedDefect.id,
        note_text: notes,
        created_by: user.id,
      }]);

      if (error) throw error;

      setNotes('');
      // Reload selected defect
      const { data } = await supabase
        .from('defects')
        .select(`
          *,
          reported_by:users!reported_by(email, full_name),
          assigned_to_user:users!assigned_to(email, full_name),
          defect_notes(id, note_text, status_change, created_by, created_at),
          defect_attachments(id, file_name, file_type, file_path, created_at)
        `)
        .eq('id', selectedDefect.id)
        .single();

      if (data) setSelectedDefect(data);
    } catch (err) {
      setAuthError('Error adding note: ' + err.message);
    }
  };

  // Load defect details
  const loadDefectDetails = async (defectId) => {
    try {
      const { data, error } = await supabase
        .from('defects')
        .select(`
          *,
          reported_by:users!reported_by(email, full_name),
          assigned_to_user:users!assigned_to(email, full_name),
          defect_notes(id, note_text, status_change, created_by, created_at),
          defect_attachments(id, file_name, file_type, file_path, created_at)
        `)
        .eq('id', defectId)
        .single();

      if (error) throw error;
      setSelectedDefect(data);
      setCurrentView('detail');
    } catch (err) {
      console.error('Error loading defect details:', err);
    }
  };

  // Get filtered defects
  const filteredDefects = defects.filter(d => {
    const statusMatch = filterStatus === 'All' || d.status === filterStatus;
    const priorityMatch = filterPriority === 'All' || d.priority === filterPriority;
    return statusMatch && priorityMatch;
  });

  // Login view
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">DefectTrack</h1>
          <p className="text-center text-gray-600 mb-6">Site Defect Reporting System</p>

          {authError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="your@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Login'}
            </button>
          </form>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300"></div></div>
            <div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-gray-500">or</span></div>
          </div>

          <button
            onClick={handleSignup}
            disabled={loading || !email || !password}
            className="w-full border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-medium py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Create Account'}
          </button>
        </div>
      </div>
    );
  }

  // Main app view
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">DefectTrack</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.email}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex gap-2">
          <button
            onClick={() => { setCurrentView('list'); setAuthError(''); }}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${currentView === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            📋 Defects
          </button>
          <button
            onClick={() => { setCurrentView('create'); setAuthError(''); }}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${currentView === 'create' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            ➕ Report Defect
          </button>
        </div>
      </div>

      {/* Error message */}
      {authError && (
        <div className="max-w-4xl mx-auto px-4 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {authError}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* List View */}
        {currentView === 'list' && (
          <div>
            <div className="bg-white rounded-lg shadow mb-4 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  >
                    <option>All</option>
                    <option>Open</option>
                    <option>Assigned</option>
                    <option>Pending Verification</option>
                    <option>Closed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  >
                    <option>All</option>
                    <option>Urgent</option>
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {filteredDefects.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
                  No defects found
                </div>
              ) : (
                filteredDefects.map(defect => (
                  <div
                    key={defect.id}
                    onClick={() => loadDefectDetails(defect.id)}
                    className="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-gray-800">{defect.defect_number}</h3>
                      <div className="flex gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          defect.priority === 'Urgent' ? 'bg-red-100 text-red-800' :
                          defect.priority === 'High' ? 'bg-orange-100 text-orange-800' :
                          defect.priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {defect.priority}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          defect.status === 'Open' ? 'bg-blue-100 text-blue-800' :
                          defect.status === 'Assigned' ? 'bg-purple-100 text-purple-800' :
                          defect.status === 'Pending Verification' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {defect.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{defect.issue_description}</p>
                    <p className="text-xs text-gray-500">📍 {defect.location}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Create Defect View */}
        {currentView === 'create' && (
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Report New Defect</h2>

            <form onSubmit={handleCreateDefect} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location / Zone *</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  placeholder="e.g., Ground Floor - MEP Area, Level 5 - Corridor A"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Issue Description *</label>
                <textarea
                  value={formData.issue_description}
                  onChange={(e) => setFormData({...formData, issue_description: e.target.value})}
                  placeholder="Describe the defect in detail"
                  rows="5"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority *</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option>Urgent</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Attach Photos / Drawings</label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])}
                  accept="image/*,.pdf"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                {files.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <p key={i} className="text-xs text-gray-600">📎 {f.name}</p>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg disabled:opacity-50"
              >
                {loading ? 'Submitting...' : 'Submit Defect'}
              </button>
            </form>
          </div>
        )}

        {/* Detail View */}
        {currentView === 'detail' && selectedDefect && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">{selectedDefect.defect_number}</h2>
                <p className="text-sm text-gray-600">Reported by: {selectedDefect.reported_by?.email}</p>
              </div>
              <div className="flex gap-2">
                <span className={`px-3 py-1 rounded font-medium ${
                  selectedDefect.priority === 'Urgent' ? 'bg-red-100 text-red-800' :
                  selectedDefect.priority === 'High' ? 'bg-orange-100 text-orange-800' :
                  selectedDefect.priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  {selectedDefect.priority}
                </span>
                <span className={`px-3 py-1 rounded font-medium ${
                  selectedDefect.status === 'Open' ? 'bg-blue-100 text-blue-800' :
                  selectedDefect.status === 'Assigned' ? 'bg-purple-100 text-purple-800' :
                  selectedDefect.status === 'Pending Verification' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  {selectedDefect.status}
                </span>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Details</h3>
                <div className="space-y-2 text-sm">
                  <p><strong>Location:</strong> {selectedDefect.location}</p>
                  <p><strong>Issue:</strong> {selectedDefect.issue_description}</p>
                  <p><strong>Created:</strong> {new Date(selectedDefect.created_at).toLocaleDateString()}</p>
                  {selectedDefect.assigned_date && (
                    <p><strong>Assigned:</strong> {new Date(selectedDefect.assigned_date).toLocaleDateString()}</p>
                  )}
                  {selectedDefect.closed_date && (
                    <p><strong>Closed:</strong> {new Date(selectedDefect.closed_date).toLocaleDateString()}</p>
                  )}
                  {selectedDefect.root_cause && (
                    <p><strong>Root Cause:</strong> {selectedDefect.root_cause}</p>
                  )}
                </div>
              </div>

              {/* Action buttons based on status */}
              {selectedDefect.status === 'Open' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-3">Assign Defect</h3>
                  <div className="space-y-3">
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                    >
                      <option value="">Select person</option>
                      {allUsers.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAssignDefect}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded text-sm"
                    >
                      Assign
                    </button>
                  </div>
                </div>
              )}

              {selectedDefect.status === 'Pending Verification' && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-700 mb-3">Close Defect</h3>
                  <div className="space-y-3">
                    <textarea
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      placeholder="Root cause..."
                      rows="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      required
                    />
                    <button
                      onClick={handleCloseDefect}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded text-sm"
                    >
                      Close Defect
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Attachments */}
            {selectedDefect.defect_attachments && selectedDefect.defect_attachments.length > 0 && (
              <div className="mb-6 pb-6 border-b">
                <h3 className="font-semibold text-gray-700 mb-3">Attachments</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {selectedDefect.defect_attachments.map(att => (
                    <div key={att.id} className="bg-gray-50 p-3 rounded text-center">
                      <p className="text-2xl mb-1">{att.file_type === 'pdf' ? '📄' : '📷'}</p>
                      <p className="text-xs text-gray-600 truncate">{att.file_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Timeline */}
            <div className="mb-6 pb-6 border-b">
              <h3 className="font-semibold text-gray-700 mb-3">Timeline & Notes</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
                {selectedDefect.defect_notes && selectedDefect.defect_notes.map(note => (
                  <div key={note.id} className="bg-gray-50 p-3 rounded text-sm">
                    <div className="flex justify-between mb-1">
                      <p className="font-medium text-gray-700">
                        {note.status_change && `[${note.status_change}]`} {note.status_change ? '' : 'Note'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(note.created_at).toLocaleDateString()}{' '}
                        {new Date(note.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <p className="text-gray-700">{note.note_text}</p>
                  </div>
                ))}
              </div>

              {selectedDefect.status !== 'Closed' && (
                <div className="space-y-2">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add a note..."
                    rows="2"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                  <button
                    onClick={handleAddNote}
                    className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 rounded text-sm"
                  >
                    Add Note
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => { setCurrentView('list'); setSelectedDefect(null); }}
              className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-medium py-2 rounded"
            >
              Back to List
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
