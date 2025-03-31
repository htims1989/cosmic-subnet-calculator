import React from 'react';
import './App.css';
// Importing the fixed version instead of the original
import FixedSubnetCalculator from './components/SubnetCalculator';

function App() {
  return (
    <div className="App">
      <FixedSubnetCalculator />
    </div>
  );
}

export default App;
