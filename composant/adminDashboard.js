// Exemple de composant React pour le dashboard
import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [realtimeData, setRealtimeData] = useState(null);
  const [timeRange, setTimeRange] = useState('7d');

  useEffect(() => {
    loadDashboardStats();
    loadRealtimeData();
    
    // Rafraîchissement automatique toutes les 30 secondes
    const interval = setInterval(loadRealtimeData, 30000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const loadDashboardStats = async () => {
    try {
      const response = await fetch(`/api/admin/dashboard/stats?range=${timeRange}`);
      const data = await response.json();
      if (data.success) setStats(data.data);
    } catch (error) {
      console.error('Erreur chargement statistiques:', error);
    }
  };

  const loadRealtimeData = async () => {
    try {
      const response = await fetch('/api/admin/realtime');
      const data = await response.json();
      if (data.success) setRealtimeData(data.data);
    } catch (error) {
      console.error('Erreur données temps réel:', error);
    }
  };

  if (!stats) return <div>Chargement...</div>;

  return (
    <div className="admin-dashboard">
      {/* En-tête avec indicateurs clés */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Utilisateurs</h3>
          <div className="stat-value">{stats.users.total}</div>
          <div className="stat-growth">
            {stats.users.growth > 0 ? '↗' : '↘'} {Math.abs(stats.users.growth).toFixed(1)}%
          </div>
        </div>
        
        <div className="stat-card">
          <h3>Chauffeurs</h3>
          <div className="stat-value">{stats.drivers.total}</div>
          <div className="stat-growth">
            {stats.drivers.growth > 0 ? '↗' : '↘'} {Math.abs(stats.drivers.growth).toFixed(1)}%
          </div>
        </div>
        
        <div className="stat-card">
          <h3>Courses</h3>
          <div className="stat-value">{stats.rides.total}</div>
          <div className="stat-growth">
            {stats.rides.growth > 0 ? '↗' : '↘'} {Math.abs(stats.rides.growth).toFixed(1)}%
          </div>
        </div>
        
        <div className="stat-card">
          <h3>Revenus</h3>
          <div className="stat-value">{stats.revenue.total.toLocaleString()} XAF</div>
          <div className="stat-growth">
            {stats.revenue.growth > 0 ? '↗' : '↘'} {Math.abs(stats.revenue.growth).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Graphiques */}
      <div className="charts-grid">
        <div className="chart-card">
          <h4>Évolution des courses</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats.rides.timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h4>Répartition des paiements</h4>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={Object.entries(stats.financial.by_payment_method).map(([method, data]) => ({
                  name: method,
                  value: data.amount
                }))}
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                label
              />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Données temps réel */}
      {realtimeData && (
        <div className="realtime-section">
          <h3>Activité en temps réel</h3>
          <div className="realtime-grid">
            <div className="realtime-card">
              <h4>Courses actives ({realtimeData.active_rides.length})</h4>
              {realtimeData.active_rides.map(ride => (
                <div key={ride.id} className="ride-item">
                  <span className={`status ${ride.status}`}>{ride.status}</span>
                  <span>{ride.customer?.name}</span>
                  <span>{ride.pickup_address}</span>
                </div>
              ))}
            </div>

            <div className="realtime-card">
              <h4>Chauffeurs en ligne ({realtimeData.online_drivers.length})</h4>
              {realtimeData.online_drivers.map(driver => (
                <div key={driver.id} className="driver-item">
                  <span>{driver.name}</span>
                  <span>{driver.vehicle}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;