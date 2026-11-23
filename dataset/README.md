# Dataset Directory

This directory is reserved for raw dataset inputs used by the optional ETL pipeline scripts (`scripts/etl-dataset.js` and `scripts/etl-reviews-calendar.js`).

## Initializing Development Data

To seed the platform with standard sample listings for development and testing, you do **not** need raw CSV files. Run:

```bash
node init/index.js
```

This seeds the MongoDB database with curated vacation rental properties from `init/data.js`.

## Optional Full Ingestion (Inside Airbnb Seattle)

If you wish to run the full-scale ETL ingestion pipeline:

1. Obtain the **Inside Airbnb Seattle** dataset files:
   - `listings.csv`
   - `reviews.csv`
   - `calendar.csv`
2. Place the CSV files in this directory (`dataset/`).
3. Execute the ETL pipelines:
   ```bash
   # Ingest listings & top reviews
   npm run etl

   # Ingest reviews and calendar booking intervals
   npm run etl:full
   ```

*Note: Large raw `.csv` and `.zip` dataset archives are excluded from Git version control via `.gitignore` to keep repository clone sizes lean.*
