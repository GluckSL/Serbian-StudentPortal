const allowedOrigins = ["http://localhost:4200", "http://16.170.204.125", "http://13.62.216.210", "https://13.62.216.210", "https://gluckstudentsportal.com", "https://www.gluckstudentsportal.com"];

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like mobile apps, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));