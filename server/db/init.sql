-- ============================================
-- Voice Calendar - Database Initialization
-- Run this script to create the database and tables.
-- Usage: mysql -u root -p < server/db/init.sql
-- ============================================

CREATE DATABASE IF NOT EXISTS voice_calendar
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE voice_calendar;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(100) NOT NULL,
  password      VARCHAR(255) NOT NULL,
  has_seen_tour TINYINT(1)   DEFAULT 0,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id         INT          PRIMARY KEY AUTO_INCREMENT,
  user_id    INT          NOT NULL,
  title      VARCHAR(200) NOT NULL,
  start_time DATETIME     NOT NULL,
  end_time   DATETIME     DEFAULT NULL,
  reminder   INT          DEFAULT 10,
  reminded   TINYINT      DEFAULT 0,
  contact_id INT          DEFAULT NULL,
  event_type VARCHAR(40)  DEFAULT 'general',
  mail_status VARCHAR(30) DEFAULT 'none',
  mail_subject VARCHAR(200) DEFAULT NULL,
  mail_body_override TEXT DEFAULT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_contact_id (contact_id),
  INDEX idx_start_time (start_time),
  INDEX idx_reminded (reminded, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TalentMate: personal relationship directory
-- contact_type: family / friend / acquaintance
-- department: 关系圈/怎么认识；role: 称呼；onboard_date: 相识日/纪念日
CREATE TABLE IF NOT EXISTS contacts (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  user_id       INT          NOT NULL,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(120) DEFAULT NULL,
  phone         VARCHAR(40)  DEFAULT NULL,
  contact_type  VARCHAR(30)  DEFAULT 'friend',
  department    VARCHAR(80)  DEFAULT NULL,
  role          VARCHAR(120) DEFAULT NULL,
  birthday      DATE         DEFAULT NULL,
  onboard_date  DATE         DEFAULT NULL,
  avatar_color  VARCHAR(20)  DEFAULT '#1677FF',
  -- 人工指定的关注等级，参与热度阈值加权：high 更早提醒，low 更晚提醒
  care_level    VARCHAR(20)  DEFAULT 'normal',
  -- 自定义提醒阈值（天）。为空表示沿用 care_level 推导出来的预设值
  care_warn_days   INT DEFAULT NULL,
  care_danger_days INT DEFAULT NULL,
  notes         TEXT         DEFAULT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_contacts_user_name (user_id, name),
  INDEX idx_contacts_type (user_id, contact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TalentMate V2: interaction history
CREATE TABLE IF NOT EXISTS interaction_logs (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  user_id     INT          NOT NULL,
  contact_id  INT          DEFAULT NULL,
  event_id    INT          DEFAULT NULL,
  action_type VARCHAR(40)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  detail      TEXT         DEFAULT NULL,
  occurred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  INDEX idx_logs_user_contact (user_id, contact_id, occurred_at),
  INDEX idx_logs_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
