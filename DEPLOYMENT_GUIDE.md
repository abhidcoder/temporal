# Deployment Guide for Temporal Data Sync Project

## Overview

This guide covers multiple deployment strategies for your Temporal-based data synchronization system, from local development to production environments.

## **1. Local Development with Docker Compose (Recommended for Testing)**

### **Prerequisites**
- Docker and Docker Compose installed
- Environment variables configured

### **Setup**

1. **Create Environment File**
```bash
# .env
NODE_ENV=development
PORT=3000
TEMPORAL_ADDRESS=localhost:7233

# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
MYSQL_ROOT_PASSWORD=your_root_password

# External Services
BASE_URL=https://your-api-domain.com
ORDERING_APP_BASE_URL=https://your-ordering-app.com

# Firebase Configuration (if using service account)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
```

2. **Start Services**
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app-server
docker-compose logs -f app-worker

# Stop services
docker-compose down
```

3. **Access Services**
- **Application API**: http://localhost:3000
- **Temporal Web UI**: http://localhost:8233
- **MySQL**: localhost:3306
- **PostgreSQL (Temporal)**: localhost:5432

## **2. Production Deployment Options**

### **Option A: Kubernetes Deployment (Enterprise)**

#### **Kubernetes Manifests**

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: temporal-sync
```

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: temporal-sync
data:
  NODE_ENV: "production"
  TEMPORAL_ADDRESS: "temporal-server:7233"
  BASE_URL: "https://your-api-domain.com"
```

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: temporal-sync
type: Opaque
data:
  DB_PASSWORD: <base64-encoded-password>
  FIREBASE_PRIVATE_KEY: <base64-encoded-key>
```

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-sync-server
  namespace: temporal-sync
spec:
  replicas: 3
  selector:
    matchLabels:
      app: temporal-sync-server
  template:
    metadata:
      labels:
        app: temporal-sync-server
    spec:
      containers:
      - name: app-server
        image: your-registry/temporal-sync:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: app-config
        - secretRef:
            name: app-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: temporal-sync-service
  namespace: temporal-sync
spec:
  selector:
    app: temporal-sync-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

#### **Deploy to Kubernetes**
```bash
# Apply manifests
kubectl apply -f k8s/

# Check deployment
kubectl get pods -n temporal-sync
kubectl logs -f deployment/temporal-sync-server -n temporal-sync
```

### **Option B: Cloud Platform Deployment**

#### **AWS ECS/Fargate**

```json
// task-definition.json
{
  "family": "temporal-sync",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "app-server",
      "image": "your-ecr-repo/temporal-sync:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "TEMPORAL_ADDRESS",
          "value": "your-temporal-cluster:7233"
        }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:db-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/temporal-sync",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### **Google Cloud Run**

```yaml
# cloud-run.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: temporal-sync
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "10"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
      - image: gcr.io/your-project/temporal-sync:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: TEMPORAL_ADDRESS
          value: "your-temporal-cluster:7233"
        resources:
          limits:
            cpu: "1000m"
            memory: "512Mi"
```

### **Option C: Traditional Server Deployment**

#### **Using PM2 (Process Manager)**

1. **Install PM2**
```bash
npm install -g pm2
```

2. **Create PM2 Configuration**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'temporal-sync-server',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'temporal-sync-worker',
      script: 'src/Workflow/worker.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

3. **Deploy with PM2**
```bash
# Start applications
pm2 start ecosystem.config.js --env production

# Monitor
pm2 monit

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## **3. CI/CD Pipeline Setup**

### **GitHub Actions**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    - run: npm ci
    - run: npm test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Build Docker image
      run: docker build -t temporal-sync:${{ github.sha }} .
    
    - name: Push to registry
      run: |
        docker tag temporal-sync:${{ github.sha }} your-registry/temporal-sync:latest
        docker push your-registry/temporal-sync:latest
    
    - name: Deploy to Kubernetes
      run: |
        kubectl set image deployment/temporal-sync-server \
          app-server=your-registry/temporal-sync:latest \
          -n temporal-sync
```

## **4. Environment-Specific Configurations**

### **Development Environment**
```bash
# .env.development
NODE_ENV=development
PORT=3000
TEMPORAL_ADDRESS=localhost:7233
DB_HOST=localhost
DB_USER=dev_user
DB_PASSWORD=dev_password
DB_NAME=dev_database
BASE_URL=https://dev-api.example.com
```

### **Staging Environment**
```bash
# .env.staging
NODE_ENV=staging
PORT=3000
TEMPORAL_ADDRESS=staging-temporal.example.com:7233
DB_HOST=staging-db.example.com
DB_USER=staging_user
DB_PASSWORD=staging_password
DB_NAME=staging_database
BASE_URL=https://staging-api.example.com
```

### **Production Environment**
```bash
# .env.production
NODE_ENV=production
PORT=3000
TEMPORAL_ADDRESS=prod-temporal.example.com:7233
DB_HOST=prod-db.example.com
DB_USER=prod_user
DB_PASSWORD=prod_password
DB_NAME=prod_database
BASE_URL=https://api.example.com
```

## **5. Monitoring and Observability**

### **Health Check Endpoint**
Add to your `server.js`:
```javascript
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version
  });
});
```

### **Logging Configuration**
```javascript
// src/utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'temporal-sync' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

## **6. Security Considerations**

### **Environment Variables**
- Never commit `.env` files to version control
- Use secrets management services (AWS Secrets Manager, HashiCorp Vault)
- Rotate credentials regularly

### **Network Security**
- Use VPCs and security groups
- Implement proper firewall rules
- Use HTTPS for all external communications

### **Container Security**
- Run containers as non-root users
- Scan images for vulnerabilities
- Keep base images updated

## **7. Scaling Strategies**

### **Horizontal Scaling**
- Deploy multiple instances behind a load balancer
- Use auto-scaling groups based on CPU/memory metrics
- Implement proper session management

### **Database Scaling**
- Use read replicas for read-heavy operations
- Implement connection pooling
- Consider database sharding for large datasets

### **Temporal Scaling**
- Deploy multiple Temporal workers
- Use Temporal's built-in scaling features
- Monitor workflow execution metrics

## **8. Backup and Disaster Recovery**

### **Database Backups**
```bash
# Automated MySQL backup script
#!/bin/bash
mysqldump -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql
```

### **Application Data**
- Backup Temporal workflow history
- Backup application logs
- Implement point-in-time recovery

## **9. Performance Optimization**

### **Application Level**
- Implement caching (Redis)
- Optimize database queries
- Use connection pooling
- Implement request rate limiting

### **Infrastructure Level**
- Use CDN for static assets
- Implement proper load balancing
- Monitor and optimize resource usage

## **10. Deployment Checklist**

- [ ] Environment variables configured
- [ ] Database migrations completed
- [ ] Health checks implemented
- [ ] Monitoring and alerting set up
- [ ] SSL certificates configured
- [ ] Backup strategy implemented
- [ ] Security measures in place
- [ ] Performance testing completed
- [ ] Rollback plan prepared
- [ ] Documentation updated

## **Quick Start Commands**

```bash
# Local development
docker-compose up -d

# Production build
docker build -t temporal-sync:latest .

# Run with PM2
pm2 start ecosystem.config.js --env production

# Deploy to Kubernetes
kubectl apply -f k8s/

# Monitor deployment
kubectl get pods -n temporal-sync
kubectl logs -f deployment/temporal-sync-server -n temporal-sync
```

This deployment guide provides comprehensive coverage for deploying your Temporal-based data synchronization system across different environments and platforms. 