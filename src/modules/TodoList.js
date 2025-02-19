import React, { useState, useEffect } from 'react';
import '../App.css';
import TodoForm from './TodoForm';
import Todo from './Todo';
import { loadTodos, saveTodos } from './TodoStorage';

// Array of background colors to cycle through
const backgroundColors = [
  '#E9ECF5', // Light Blue
  '#F5E9EC', // Light Pink
  '#ECF5E9', // Light Green
  '#F5F2E9', // Light Yellow
  '#EDE9F5', // Light Purple
  '#E9F5F2', // Light Mint
  '#F5EDE9', // Light Peach
  '#F2F5E9', // Light Lime
];

function TodoList() {
  const [todos, setTodos] = useState(() => loadTodos());
  const [colorIndex, setColorIndex] = useState(0);

  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  const addTodo = todo => {
    if (!todo.text || /^\s*$/.test(todo.text)) {
      return;
    }

    const newTodo = {
      ...todo,
      id: Date.now(),
      createdAt: new Date().toISOString(),
      isComplete: false,
      backgroundColor: backgroundColors[colorIndex] // Add background color
    };

    setTodos(prevTodos => [newTodo, ...prevTodos]);
    
    // Cycle to next color
    setColorIndex((prevIndex) => 
      prevIndex === backgroundColors.length - 1 ? 0 : prevIndex + 1
    );
  };

  const updateTodo = (todoId, newValue) => {
    if (!newValue.text || /^\s*$/.test(newValue.text)) {
      return;
    }

    setTodos(prev => prev.map(item => 
      item.id === todoId 
        ? { ...item, text: newValue.text, updatedAt: new Date().toISOString() }
        : item
    ));
  };

  const removeTodo = id => {
    setTodos(prevTodos => prevTodos.filter(todo => todo.id !== id));
  };

  const completeTodo = id => {
    setTodos(prevTodos => 
      prevTodos.map(todo =>
        todo.id === id
          ? { ...todo, isComplete: !todo.isComplete, completedAt: new Date().toISOString() }
          : todo
      )
    );
  };

  const clearCompleted = () => {
    setTodos(prevTodos => prevTodos.filter(todo => !todo.isComplete));
  };

  const deleteAllTodos = () => {
    setTodos([]);
  };

  return (
    <div className="todo-container">
      <h1>Make your list & Don't forget anything!</h1>
      <TodoForm onSubmit={addTodo} />
      {todos.length > 0 ? (
        <>
          <Todo
            todos={todos}
            completeTodo={completeTodo}
            removeTodo={removeTodo}
            updateTodo={updateTodo}
          />
          <div className="todo-stats">
            <span>{todos.filter(todo => !todo.isComplete).length} items left</span>
            <div className="todo-actions">
              <button onClick={clearCompleted} className="action-button">
                Clear completed
              </button>
              <button onClick={deleteAllTodos} className="action-button delete-all">
                Delete all
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="no-todos">No todos yet! Add one above.</p>
      )}
    </div>
  );
}

export default TodoList;