const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const ChatMessage = sequelize.define('ChatMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  ride_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'rides',
      key: 'id'
    },
    validate: {
      notEmpty: {
        msg: "L'ID de la course est obligatoire"
      }
    }
  },
  
  sender_id: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'users',
      key: 'uid'
    },
    validate: {
      notEmpty: {
        msg: "L'ID de l'expéditeur est obligatoire"
      }
    }
  },
  
  message_type: {
    type: DataTypes.ENUM('text', 'image', 'location', 'system'),
    allowNull: false,
    defaultValue: 'text',
    validate: {
      isIn: {
        args: [['text', 'image', 'location', 'system']],
        msg: "Le type de message doit être text, image, location ou system"
      }
    }
  },
  
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "Le contenu du message est obligatoire"
      },
      len: {
        args: [1, 1000],
        msg: "Le message doit contenir entre 1 et 1000 caractères"
      }
    }
  },
  
  media_url: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isUrl: {
        msg: "L'URL du média doit être valide"
      }
    }
  },
  
  is_read: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  
  read_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'chat_messages',
  indexes: [
    {
      fields: ['ride_id']
    },
    {
      fields: ['sender_id']
    },
    {
      fields: ['created_at']
    }
  ],
  hooks: {
    beforeValidate: (message) => {
      // Pour les messages système, le contenu est obligatoire mais le sender_id peut être null
      if (message.message_type === 'system' && !message.sender_id) {
        message.sender_id = 'system';
      }
    }
  }
});

module.exports = ChatMessage;