#!/bin/bash
# Setup cron jobs for MAS report scheduler
# Run this once during deployment: sudo ./scripts/setup-cron.sh

set -e

APP_DIR="/opt/mas-email-reports"
LOG_DIR="/var/log"
CRON_FILE="/etc/cron.d/mas-reports"

# Create log files with proper permissions
sudo touch "$LOG_DIR/mas-report-morning.log"
sudo touch "$LOG_DIR/mas-report-midday.log"
sudo touch "$LOG_DIR/mas-report-daily.log"
sudo chmod 666 "$LOG_DIR/mas-report-morning.log"
sudo chmod 666 "$LOG_DIR/mas-report-midday.log"
sudo chmod 666 "$LOG_DIR/mas-report-daily.log"

# Create cron file
# IMPORTANT: Cron schedules use SYSTEM timezone, not TZ variable!
# Either set system timezone: sudo timedatectl set-timezone America/New_York
# Or use UTC times below (EST = UTC-5, EDT = UTC-4)
#
# UTC times for Eastern Standard Time (EST = UTC-5):
#   7am EST  = 12:00 UTC
#   12pm EST = 17:00 UTC
#   4pm EST  = 21:00 UTC

sudo tee "$CRON_FILE" > /dev/null << EOF
# MAS Precision Parts - Report Scheduler
# Times in UTC for EST (7am=12:00, 12pm=17:00, 4pm=21:00)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
TZ=America/New_York

# 7:00 AM EST (12:00 UTC) - Morning reminder report
0 12 * * * root cd $APP_DIR && ./scripts/run-report.sh morning

# 12:00 PM EST (17:00 UTC) - Midday report
0 17 * * * root cd $APP_DIR && ./scripts/run-report.sh midday

# 4:00 PM EST (21:00 UTC) - Daily summary report
0 21 * * * root cd $APP_DIR && ./scripts/run-report.sh daily
EOF

# Set permissions
sudo chmod 644 "$CRON_FILE"

# Restart cron to pick up changes
sudo systemctl restart cron

echo "Cron jobs installed successfully!"
echo ""
echo "Scheduled reports:"
echo "  - 7:00 AM EST/EDT: Morning reminder"
echo "  - 12:00 PM EST/EDT: Midday report"
echo "  - 4:00 PM EST/EDT: Daily summary"
echo ""
echo "View cron jobs: cat $CRON_FILE"
echo "View logs: tail -f $LOG_DIR/mas-report-*.log"
