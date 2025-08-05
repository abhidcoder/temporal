# Deploying Temporal Project on Google Cloud VM with Docker

## 🚀 Overview

This guide will help you deploy your Temporal project on a Google Cloud Virtual Machine using Docker and Docker Compose.

## **Prerequisites**

1. **Google Cloud Account** with billing enabled
2. **Google Cloud SDK** installed locally
3. **Docker** and **Docker Compose** knowledge
4. **SSH key pair** for VM access

## **Step 1: Create Google Cloud VM**

### **1.1 Create VM Instance**
```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Create VM instance
gcloud compute instances create temporal-sync-vm \
  --zone=us-central1-a \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2004-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-standard \
  --tags=http-server,https-server \
  --metadata=startup-script='#! /bin/bash
    # Update system
    apt-get update
    apt-get install -y docker.io docker-compose
    systemctl start docker
    systemctl enable docker
    usermod -aG docker $USER
  '
```

### **1.2 Configure Firewall Rules**
```bash
# Allow HTTP traffic
gcloud compute firewall-rules create allow-http \
  --allow tcp:80 \
  --target-tags=http-server \
  --description="Allow HTTP traffic"

# Allow HTTPS traffic
gcloud compute firewall-rules create allow-https \
  --allow tcp:443 \
  --target-tags=https-server \
  --description="Allow HTTPS traffic"

# Allow custom ports for your app
gcloud compute firewall-rules create allow-temporal-app \
  --allow tcp:3000,7233,8233 \
  --target-tags=http-server \
  --description="Allow Temporal app ports"
```

### **1.3 Get VM External IP**
```bash
# Get the external IP
gcloud compute instances describe temporal-sync-vm \
  --zone=us-central1-a \
  --format="get(networkInterfaces[0].accessConfigs[0].natIP)"
```

## **Step 2: Connect to VM and Setup**

### **2.1 SSH into VM**
```bash
# SSH into your VM
gcloud compute ssh temporal-sync-vm --zone=us-central1-a

# Or use regular SSH if you have SSH keys set up
ssh your-username@YOUR_VM_EXTERNAL_IP
```

### **2.2 Install Docker and Dependencies**
```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
sudo apt-get install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install additional tools
sudo apt-get install -y git curl wget htop
```

### **2.3 Verify Docker Installation**
```bash
# Check Docker version
docker --version
docker-compose --version

# Test Docker
docker run hello-world
```

## **Step 3: Deploy Your Application**

### **3.1 Clone Your Repository**
```bash
# Clone your project (replace with your actual repo)
git clone https://github.com/yourusername/temporal-project.git
cd temporal-project

# Or upload files manually using SCP
# scp -r ./temporal-project user@YOUR_VM_IP:/home/user/
```

### **3.2 Create Environment File**
```bash
# Create .env file
cat > .env << EOF
# Application Configuration
NODE_ENV=production
PORT=3000
TEMPORAL_ADDRESS=temporal:7233
TEMPORAL_TASK_QUEUE=superzop-sync-queue

# Database Configuration
DB_HOST=mysql
DB_USER=your_db_user
DB_PASSWORD=your_secure_password
DB_NAME=your_database_name

# External Services
BASE_URL=https://your-api-domain.com
ORDERING_APP_BASE_URL=https://your-ordering-app.com

# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Private Key Here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
EOF
```

### **3.3 Create Production Docker Compose**
```bash
# Create production docker-compose file
cat > docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  # PostgreSQL for Temporal
  postgresql:
    image: postgres:13
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: temporal
      POSTGRES_DB: temporal
    volumes:
      - postgresql_data:/var/lib/postgresql/data
    networks:
      - temporal-network
    restart: unless-stopped

  # Temporal Server
  temporal:
    image: temporalio/auto-setup:1.22.3
    ports:
      - "7233:7233"
      - "8233:8233"
    environment:
      - DB=postgresql
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal
      - POSTGRES_SEEDS=postgresql
    depends_on:
      - postgresql
    networks:
      - temporal-network
    restart: unless-stopped

  # MySQL Database
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root_password
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - temporal-network
    restart: unless-stopped
    command: --default-authentication-plugin=mysql_native_password

  # Redis (if needed)
  redis:
    image: redis:6-alpine
    networks:
      - temporal-network
    restart: unless-stopped

  # Application Server
  app-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_TASK_QUEUE=superzop-sync-queue
      - DB_HOST=mysql
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=${DB_NAME}
      - BASE_URL=${BASE_URL}
      - ORDERING_APP_BASE_URL=${ORDERING_APP_BASE_URL}
      - FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
      - FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY}
      - FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}
    depends_on:
      - temporal
      - mysql
    networks:
      - temporal-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Application Worker
  app-worker:
    build: .
    command: npm run worker
    environment:
      - NODE_ENV=production
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_TASK_QUEUE=superzop-sync-queue
      - DB_HOST=mysql
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=${DB_NAME}
      - BASE_URL=${BASE_URL}
      - ORDERING_APP_BASE_URL=${ORDERING_APP_BASE_URL}
      - FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
      - FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY}
      - FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}
    depends_on:
      - temporal
      - mysql
    networks:
      - temporal-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "pgrep", "-f", "worker.js"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Nginx Reverse Proxy (Optional)
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app-server
    networks:
      - temporal-network
    restart: unless-stopped

volumes:
  postgresql_data:
  mysql_data:

networks:
  temporal-network:
    driver: bridge
EOF
```

### **3.4 Create Nginx Configuration (Optional)**
```bash
# Create nginx configuration
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream app_server {
        server app-server:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;

        location / {
            proxy_pass http://app_server;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /temporal {
            proxy_pass http://temporal:8233;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF
```

## **Step 4: Deploy and Start Services**

### **4.1 Build and Start Services**
```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d

# Check service status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### **4.2 Verify Deployment**
```bash
# Check if services are running
docker ps

# Test health endpoint
curl http://localhost:3000/health

# Test Temporal Web UI
curl http://localhost:8233

# Check logs for any errors
docker-compose -f docker-compose.prod.yml logs app-server
docker-compose -f docker-compose.prod.yml logs app-worker
```

## **Step 5: Setup SSL Certificate (Optional)**

### **5.1 Install Certbot**
```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

### **5.2 Update Nginx for SSL**
```bash
# Update nginx.conf for SSL
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream app_server {
        server app-server:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl;
        server_name your-domain.com;

        ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

        location / {
            proxy_pass http://app_server;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /temporal {
            proxy_pass http://temporal:8233;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF
```

## **Step 6: Monitoring and Maintenance**

### **6.1 Setup Monitoring Scripts**
```bash
# Create monitoring script
cat > monitor.sh << 'EOF'
#!/bin/bash

echo "=== Temporal Sync VM Status ==="
echo "Date: $(date)"
echo ""

echo "=== Docker Services ==="
docker-compose -f docker-compose.prod.yml ps
echo ""

echo "=== System Resources ==="
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
echo "Memory Usage:"
free -h | grep Mem
echo "Disk Usage:"
df -h /
echo ""

echo "=== Application Health ==="
curl -s http://localhost:3000/health | jq . || echo "Health check failed"
echo ""

echo "=== Recent Logs ==="
docker-compose -f docker-compose.prod.yml logs --tail=20 app-server
EOF

chmod +x monitor.sh
```

### **6.2 Setup Log Rotation**
```bash
# Create logrotate configuration
sudo tee /etc/logrotate.d/temporal-app << 'EOF'
/home/user/temporal-project/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 user user
    postrotate
        docker-compose -f /home/user/temporal-project/docker-compose.prod.yml restart app-server
        docker-compose -f /home/user/temporal-project/docker-compose.prod.yml restart app-worker
    endscript
}
EOF
```

### **6.3 Setup Backup Script**
```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/home/user/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "Creating backup: $DATE"

# Backup MySQL data
docker exec temporal-project_mysql_1 mysqldump -u root -proot_password your_database_name > $BACKUP_DIR/mysql_backup_$DATE.sql

# Backup PostgreSQL data
docker exec temporal-project_postgresql_1 pg_dump -U temporal temporal > $BACKUP_DIR/postgresql_backup_$DATE.sql

# Backup application files
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz --exclude=node_modules --exclude=logs .

echo "Backup completed: $BACKUP_DIR"
EOF

chmod +x backup.sh
```

## **Step 7: Automation and CI/CD**

### **7.1 Create Deployment Script**
```bash
# Create deployment script
cat > deploy.sh << 'EOF'
#!/bin/bash

echo "Starting deployment..."

# Pull latest changes
git pull origin main

# Stop services
docker-compose -f docker-compose.prod.yml down

# Build new images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 30

# Check health
curl -f http://localhost:3000/health && echo "Deployment successful!" || echo "Deployment failed!"
EOF

chmod +x deploy.sh
```

### **7.2 Setup GitHub Actions (Optional)**
```yaml
# .github/workflows/deploy.yml
name: Deploy to Google Cloud VM

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    
    - name: Deploy to VM
      uses: appleboy/ssh-action@v0.1.4
      with:
        host: ${{ secrets.VM_HOST }}
        username: ${{ secrets.VM_USERNAME }}
        key: ${{ secrets.VM_SSH_KEY }}
        script: |
          cd /home/user/temporal-project
          ./deploy.sh
```

## **Step 8: Security Hardening**

### **8.1 Update Firewall Rules**
```bash
# Remove default SSH access and use IAP
gcloud compute firewall-rules delete default-allow-ssh

# Create IAP tunnel for SSH
gcloud compute firewall-rules create allow-iap-ssh \
  --allow tcp:22 \
  --source-ranges 35.235.240.0/20 \
  --target-tags=allow-ssh

# Update VM to use IAP
gcloud compute instances add-tags temporal-sync-vm \
  --tags=allow-ssh \
  --zone=us-central1-a
```

### **8.2 Setup Fail2ban**
```bash
# Install fail2ban
sudo apt-get install -y fail2ban

# Configure fail2ban
sudo tee /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF

sudo systemctl restart fail2ban
```

## **Step 9: Performance Optimization**

### **9.1 Optimize Docker Settings**
```bash
# Create daemon.json for Docker optimization
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "default-ulimits": {
    "nofile": {
      "Hard": 64000,
      "Name": "nofile",
      "Soft": 64000
    }
  }
}
EOF

sudo systemctl restart docker
```

### **9.2 Setup Monitoring with Prometheus (Optional)**
```bash
# Add Prometheus service to docker-compose.prod.yml
cat >> docker-compose.prod.yml << 'EOF'

  # Prometheus Monitoring
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    networks:
      - temporal-network
    restart: unless-stopped

  # Grafana Dashboard
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
    networks:
      - temporal-network
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
EOF
```

## **Step 10: Troubleshooting**

### **10.1 Common Issues and Solutions**

#### **Issue: Services not starting**
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs

# Check disk space
df -h

# Check memory
free -h

# Restart services
docker-compose -f docker-compose.prod.yml restart
```

#### **Issue: Database connection failed**
```bash
# Check MySQL container
docker exec -it temporal-project_mysql_1 mysql -u root -p

# Check environment variables
docker-compose -f docker-compose.prod.yml config

# Test connection from app container
docker exec -it temporal-project_app-server_1 node src/database/test-sql.js
```

#### **Issue: Temporal connection failed**
```bash
# Check Temporal container
docker logs temporal-project_temporal_1

# Check network connectivity
docker exec temporal-project_app-server_1 ping temporal

# Restart Temporal
docker-compose -f docker-compose.prod.yml restart temporal
```

## **Quick Commands Reference**

### **Deployment**
```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Stop all services
docker-compose -f docker-compose.prod.yml down

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart specific service
docker-compose -f docker-compose.prod.yml restart app-server
```

### **Monitoring**
```bash
# Check status
./monitor.sh

# View real-time logs
docker-compose -f docker-compose.prod.yml logs -f --tail=100

# Check resource usage
htop
```

### **Backup and Maintenance**
```bash
# Create backup
./backup.sh

# Update application
./deploy.sh

# Clean up old images
docker image prune -f
```

## **Cost Optimization**

### **VM Sizing Recommendations**
- **Development/Testing**: e2-standard-2 (2 vCPU, 8GB RAM)
- **Production (Small)**: e2-standard-4 (4 vCPU, 16GB RAM)
- **Production (Medium)**: e2-standard-8 (8 vCPU, 32GB RAM)

### **Cost Saving Tips**
```bash
# Use preemptible instances for non-critical workloads
gcloud compute instances create temporal-sync-vm \
  --preemptible \
  --zone=us-central1-a

# Use committed use discounts for long-term deployments
# Set up billing alerts in Google Cloud Console
```

Your Temporal project is now deployed on Google Cloud VM! 🚀

**Access URLs:**
- **Application API**: http://YOUR_VM_IP:3000
- **Temporal Web UI**: http://YOUR_VM_IP:8233
- **Health Check**: http://YOUR_VM_IP:3000/health 