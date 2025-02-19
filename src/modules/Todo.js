import React, { useState } from 'react';
import TodoForm from './TodoForm';
import { RiCloseCircleLine } from 'react-icons/ri';
import { TiEdit } from 'react-icons/ti';

const Todo = ({ todos, completeTodo, removeTodo, updateTodo }) => {
  const [edit, setEdit] = useState({
    id: null,
    value: ''
  });

  const submitUpdate = value => {
    updateTodo(edit.id, value);
    setEdit({
      id: null,
      value: ''
    });
  };

  if (edit.id) {
    return <TodoForm edit={edit} onSubmit={submitUpdate} />;
  }

  return (
    <div className="todo-list">
      {todos.map((todo) => (
        <div
          className={`todo-row ${todo.isComplete ? 'complete' : ''}`}
          key={todo.id}
          style={{ backgroundColor: todo.backgroundColor }}
        >
          <div className="todo-text" onClick={() => completeTodo(todo.id)}>
            {todo.text}
          </div>
          <div className="todo-timestamps">
            {todo.completedAt && 
              <span className="timestamp">
                Completed: {new Date(todo.completedAt).toLocaleDateString()}
              </span>
            }
          </div>
          <div className='icons'>
            <RiCloseCircleLine
              onClick={() => removeTodo(todo.id)}
              className='delete-icon'
            />
            <TiEdit
              onClick={() => setEdit({ id: todo.id, value: todo.text })}
              className='edit-icon'
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default Todo;