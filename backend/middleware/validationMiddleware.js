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
        /* Types and sizes only. The address and the nickname are checked by
           accountService, with the same rules the profile renames by, and the
           answers carry codes the app can put into words. A pattern here used
           to refuse accents and spaces that a rename then allowed. */
        fields: {
            email: { type: 'string', maxLength: 255 },
            username: { type: 'string', maxLength: 255 },
            pseudo: { type: 'string', maxLength: 60 },
            password: { type: 'string', maxLength: 128 }
        }
    },
    login: {
        required: ['password'],
        fields: {
            email: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' }
        }
    },
    /* Types and sizes only, as for signup: the nickname is accountService's
       to judge (userService.updateUser), by the rule every other door uses. */
    updateProfile: {
        fields: {
            pseudo: { type: 'string', maxLength: 60 }
        }
    },
    // The eight-character minimum is authService's, answered as WEAK_PASSWORD.
    changePassword: {
        required: ['currentPassword', 'newPassword'],
        fields: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', maxLength: 128 }
        }
    },
    resetPassword: {
        required: ['token', 'newPassword'],
        fields: {
            token: { type: 'string' },
            newPassword: { type: 'string', maxLength: 128 }
        }
    }
};

module.exports = {
    validate,
    schemas
};
