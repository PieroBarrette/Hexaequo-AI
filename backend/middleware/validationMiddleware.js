/**
 * Validation Middleware
 * 
 * Request validation using schemas.
 */

const { validationError } = require('./errorHandler');

/**
 * Create validation middleware for a schema
 * @param {Object} schema - Validation schema
 * @param {string} source - 'body', 'query', or 'params'
 */
const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        const data = req[source];
        const errors = [];

        // Check required fields
        if (schema.required) {
            for (const field of schema.required) {
                if (data[field] === undefined || data[field] === null || data[field] === '') {
                    errors.push(`${field} is required`);
                }
            }
        }

        // Check field types and constraints
        if (schema.fields) {
            for (const [field, rules] of Object.entries(schema.fields)) {
                const value = data[field];

                if (value === undefined || value === null) continue;

                // Type check
                if (rules.type) {
                    const actualType = Array.isArray(value) ? 'array' : typeof value;
                    if (actualType !== rules.type) {
                        errors.push(`${field} must be a ${rules.type}`);
                        continue;
                    }
                }

                // String constraints
                if (rules.type === 'string') {
                    if (rules.minLength && value.length < rules.minLength) {
                        errors.push(`${field} must be at least ${rules.minLength} characters`);
                    }
                    if (rules.maxLength && value.length > rules.maxLength) {
                        errors.push(`${field} must be at most ${rules.maxLength} characters`);
                    }
                    if (rules.pattern && !rules.pattern.test(value)) {
                        errors.push(`${field} format is invalid`);
                    }
                    if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        errors.push(`${field} must be a valid email`);
                    }
                }

                // Number constraints
                if (rules.type === 'number') {
                    if (rules.min !== undefined && value < rules.min) {
                        errors.push(`${field} must be at least ${rules.min}`);
                    }
                    if (rules.max !== undefined && value > rules.max) {
                        errors.push(`${field} must be at most ${rules.max}`);
                    }
                }

                // Enum check
                if (rules.enum && !rules.enum.includes(value)) {
                    errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
                }
            }
        }

        if (errors.length > 0) {
            return next(validationError(errors.join('; ')));
        }

        next();
    };
};

// Common validation schemas
const schemas = {
    signup: {
        required: ['email', 'pseudo', 'password'],
        fields: {
            email: { type: 'string', email: true, maxLength: 255 },
            pseudo: { type: 'string', minLength: 3, maxLength: 30, pattern: /^[a-zA-Z0-9_-]+$/ },
            password: { type: 'string', minLength: 8, maxLength: 128 }
        }
    },
    login: {
        required: ['email', 'password'],
        fields: {
            email: { type: 'string', email: true },
            password: { type: 'string' }
        }
    },
    updateProfile: {
        fields: {
            pseudo: { type: 'string', minLength: 3, maxLength: 30, pattern: /^[a-zA-Z0-9_-]+$/ }
        }
    },
    createRoom: {
        fields: {
            timeMode: { type: 'string', enum: ['none', 'classic', 'rapid', 'blitz'] },
            allowSpectators: { type: 'boolean' }
        }
    },
    changePassword: {
        required: ['currentPassword', 'newPassword'],
        fields: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8, maxLength: 128 }
        }
    },
    resetPassword: {
        required: ['token', 'newPassword'],
        fields: {
            token: { type: 'string' },
            newPassword: { type: 'string', minLength: 8, maxLength: 128 }
        }
    }
};

module.exports = {
    validate,
    schemas
};
