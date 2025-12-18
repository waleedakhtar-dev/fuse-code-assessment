export default () => ({
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'orders',
    password: process.env.DB_PASSWORD || 'orders',
    name: process.env.DB_NAME || 'orders',
  },
});


