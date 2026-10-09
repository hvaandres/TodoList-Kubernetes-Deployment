import React from 'react';
import TodoList from './modules/TodoList';
import { installErrorReporting } from './observability';
import './App.css';

function App() {
  React.useEffect(() => installErrorReporting(), []);

  return (
    <div className="todo-app">
      <h1>To-Do App Version 3</h1>
      <TodoList />
    </div>
  );
}

export default App;