# Railway Deployment Guide

## Architecture
- **Frontend**: Vercel (already deployed)
- **Backend**: Railway (Express/Node.js)
- **Simulation Engine**: Railway (Python/FastAPI)

## Backend Configuration (Railway)

### Root Directory
`FYP_Backend`

### Build Command
```bash
npm install
```

### Start Command
```bash
node server.js
```

### Environment Variables
```
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/spotdb
PORT=5000
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
SIMULATION_ENGINE_URL=https://your-simulation-engine.railway.app
ALLOWED_ORIGINS=https://spot-kohl-nine.vercel.app,http://localhost:5173
FRONTEND_URL=https://spot-kohl-nine.vercel.app
```

## Simulation Engine Configuration (Railway)

### Root Directory
`Simulation_Engine`

### Build Command
```bash
pip install -r requirements.txt
```

### Start Command
```bash
uvicorn api:app --host 0.0.0.0 --port $PORT
```

### Environment Variables
```
PORT=8000
```

## Railway vs Render Free Tier

| Feature | Railway | Render |
|---------|---------|--------|
| Hours/month | 500 | 750 (but suspended) |
| Services | Unlimited | Limited |
| Build time | Faster | Slower |
| Logs | Real-time | Delayed |
| Suspensions | Rare | Frequent |

## Health Check URLs

After deployment, verify:
- Backend: `https://your-backend.railway.app/health`
- Engine: `https://your-engine.railway.app/health`

## Troubleshooting

### Backend won't start
- Check MongoDB connection string
- Verify all environment variables are set
- Check Railway logs for errors

### Simulation Engine won't start
- Verify Python version (3.11+)
- Check if requirements.txt exists
- Review Railway build logs

### Frontend can't connect
- Update VITE_API_URL in Vercel
- Add Vercel domain to ALLOWED_ORIGINS in Railway
- Redeploy Vercel after changing env vars

## Cost Optimization

Railway free tier = 500 hours/month = ~16 hours/day for 2 services combined.

To stay within free tier:
- Services sleep after 30 min of inactivity
- First request wakes them up (cold start ~10s)
- No action needed - automatic

## Migration Checklist

- [ ] Deploy Backend to Railway
- [ ] Deploy Simulation Engine to Railway
- [ ] Generate Railway domains for both
- [ ] Update Backend SIMULATION_ENGINE_URL
- [ ] Update Vercel VITE_API_URL
- [ ] Test health endpoints
- [ ] Test full user flow
- [ ] Update monitoring (UptimeRobot) URLs
- [ ] Delete Render services (optional)
