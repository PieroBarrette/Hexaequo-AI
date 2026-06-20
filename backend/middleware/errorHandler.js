/**
 * Error Handler Middleware
 * 
 * Centralized error handling with consistent response format.
 */

const { NODE_ENV } = require('../config/env');

/**
 * Custom application error class
 */
class AppError extends Error {
    constructor(message, statusCode, code = null) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    // Default values
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';
    let code = err.code || 'INTERNAL_ERROR';

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = err.message;
    }

    if (err.name === 'CastError') {
        statusCode = 400;
        code = 'INVALID_ID';
        message = 'Invalid ID format';
    }

    if (err.code === 11000) {
        // MongoDB duplicate key error
        statusCode = 409;
        code = 'DUPLICATE_ERROR';
        message = 'Resource already exists';
    }

    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        code = 'INVALID_TOKEN';
        message = 'Invalid token';
    }

    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        code = 'TOKEN_EXPIRED';
        message = 'Token expired';
    }

    // Log error in development
    if (NODE_ENV === 'development') {
        console.error('Error:', {
            message: err.message,
            stack: err.stack,
            statusCode,
            code
        });
    }

    // Send error response
    const response = {
        error: code,
        message
    };

    // Include stack trace in development
    if (NODE_ENV === 'development' && !err.isOperational) {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

/**
 * Not Found error generator
 */
const notFound = (resource = 'Resource') => {
    return new AppError(`${resource} not found`, 404, 'NOT_FOUND');
};

/**
 * Validation error generator
 */
const validationError = (message) => {
    return new AppError(message, 400, 'VALIDATION_ERROR');
};

/**
 * Unauthorized error generator
 */
const unauthorized = (message = 'Authentication required') => {
    return new AppError(message, 401, 'UNAUTHORIZED');
};

/**
 * Forbidden error generator
 */
const forbidden = (message = 'Access denied') => {
    return new AppError(message, 403, 'FORBIDDEN');
};

/**
 * Conflict error generator
 */
const conflict = (message = 'Resource already exists') => {
    return new AppError(message, 409, 'CONFLICT');
};

module.exports = {
    AppError,
    errorHandler,
    notFound,
    validationError,
    unauthorized,
    forbidden,
    conflict
};
