import React, { createContext, useState, useEffect, ReactNode, useRef } from 'react';
import { 
  createRandomMailbox, 
  getMailboxFromLocalStorage, 
  saveMailboxToLocalStorage,
  removeMailboxFromLocalStorage,
  getEmails,
  deleteMailbox as deleteMailboxApi
} from '../utils/api';
import { useTranslation } from 'react-i18next';
import { DEFAULT_AUTO_REFRESH, AUTO_REFRESH_INTERVAL } from '../config';

// 邮件详情缓存接口
interface EmailCache {
  [emailId: string]: {
    email: Email;
    attachments: any[];
    timestamp: number;
  }
}

interface MailboxContextType {
  mailbox: Mailbox | null;
  setMailbox: (mailbox: Mailbox) => void;
  isLoading: boolean;
  emails: Email[];
  setEmails: (emails: Email[]) => void;
  selectedEmail: string | null;
  setSelectedEmail: (id: string | null) => void;
  isEmailsLoading: boolean;
  setIsEmailsLoading: (loading: boolean) => void;
  autoRefresh: boolean;
  setAutoRefresh: (autoRefresh: boolean) => void;
  createNewMailbox: () => Promise<void>;
  deleteMailbox: () => void;
  refreshEmails: () => Promise<void>;
  emailCache: EmailCache;
  addToEmailCache: (emailId: string, email: Email, attachments: any[]) => void;
  clearEmailCache: () => void;
  handleMailboxNotFound: () => Promise<void>;
  errorMessage: string | null;
  successMessage: string | null;
  savedMailboxes: Mailbox[];
  deleteMailboxFromSaved: (address: string) => Promise<void>;
  clearAllMailboxes: () => Promise<void>;
}

export const MailboxContext = createContext<MailboxContextType>({
  mailbox: null,
  setMailbox: () => {},
  isLoading: false,
  emails: [],
  setEmails: () => {},
  selectedEmail: null,
  setSelectedEmail: () => {},
  isEmailsLoading: false,
  setIsEmailsLoading: () => {},
  autoRefresh: DEFAULT_AUTO_REFRESH,
  setAutoRefresh: () => {},
  createNewMailbox: async () => {},
  deleteMailbox: () => {},
  refreshEmails: async () => {},
  emailCache: {},
  addToEmailCache: () => {},
  clearEmailCache: () => {},
  handleMailboxNotFound: async () => {},
  errorMessage: null,
  successMessage: null,
  savedMailboxes: [],
  deleteMailboxFromSaved: async () => {},
  clearAllMailboxes: async () => {}
});

interface MailboxProviderProps {
  children: ReactNode;
}

export const MailboxProvider: React.FC<MailboxProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [savedMailboxes, setSavedMailboxes] = useState<Mailbox[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [isEmailsLoading, setIsEmailsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(DEFAULT_AUTO_REFRESH);
  const [emailCache, setEmailCache] = useState<EmailCache>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);
  const successTimeoutRef = useRef<number | null>(null);
  
  // 清除提示的定时器
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        window.clearTimeout(errorTimeoutRef.current);
      }
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);
  
  // 初始化：检查本地存储或创建新邮箱
  useEffect(() => {
    const initMailbox = async () => {
      // 1. 获取并清理过期的已保存邮箱
      const saved = localStorage.getItem('savedMailboxes');
      let validSavedMailboxes: Mailbox[] = [];
      const now = Date.now() / 1000;
      
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Mailbox[];
          validSavedMailboxes = parsed.filter(m => m.expiresAt > now);
          localStorage.setItem('savedMailboxes', JSON.stringify(validSavedMailboxes));
          setSavedMailboxes(validSavedMailboxes);
        } catch (e) {
          console.error('Failed to parse savedMailboxes', e);
        }
      }
      
      // 2. 检查当前邮箱
      const savedMailbox = getMailboxFromLocalStorage();
      
      if (savedMailbox) {
        setMailbox(savedMailbox);
        // 确保当前邮箱存在于已保存列表中
        const exists = validSavedMailboxes.some(m => m.address === savedMailbox.address);
        if (!exists) {
          const updated = [...validSavedMailboxes, savedMailbox];
          localStorage.setItem('savedMailboxes', JSON.stringify(updated));
          setSavedMailboxes(updated);
        }
        setIsLoading(false);
      } else {
        // 如果当前没有邮箱，但保存列表里有有效的，使用第一个
        if (validSavedMailboxes.length > 0) {
          setMailbox(validSavedMailboxes[0]);
          saveMailboxToLocalStorage(validSavedMailboxes[0]);
          setIsLoading(false);
        } else {
          // 创建新邮箱
          await createNewMailbox();
        }
      }
    };
    
    initMailbox();
  }, []);
  
  // 创建新邮箱
  const createNewMailbox = async () => {
    try {
      // 清除之前的错误和成功信息
      setErrorMessage(null);
      setSuccessMessage(null);
      
      console.log('createNewMailbox: Started');
      setIsLoading(true);
      
      console.log('createNewMailbox: Calling createRandomMailbox...');
      const result = await createRandomMailbox();
      console.log('createNewMailbox: createRandomMailbox result:', result);
      
      if (result.success && result.mailbox) {
        console.log('createNewMailbox: Setting new mailbox:', result.mailbox);
        setMailbox(result.mailbox);
        saveMailboxToLocalStorage(result.mailbox);
        
        // 保存到列表
        setSavedMailboxes(prev => {
          const updated = [...prev.filter(m => m.address !== result.mailbox!.address), result.mailbox!];
          localStorage.setItem('savedMailboxes', JSON.stringify(updated));
          return updated;
        });
      } else {
        console.error('createNewMailbox: Failed to create mailbox:', result.error);
        setErrorMessage(t('mailbox.createFailed'));
        
        // 3秒后清除错误信息
        if (errorTimeoutRef.current) {
          window.clearTimeout(errorTimeoutRef.current);
        }
        errorTimeoutRef.current = window.setTimeout(() => {
          setErrorMessage(null);
        }, 3000);
        throw new Error('Failed to create mailbox');
      }
    } catch (error) {
      console.error('createNewMailbox: Error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };
  
  // 从保存列表中删除指定邮箱并从后端彻底删除
  const deleteMailboxFromSaved = async (address: string) => {
    // 1. 从列表中移除并更新本地存储
    let remaining: Mailbox[] = [];
    setSavedMailboxes(prev => {
      const updated = prev.filter(m => m.address !== address);
      localStorage.setItem('savedMailboxes', JSON.stringify(updated));
      remaining = updated;
      return updated;
    });

    // 清除该邮箱的缓存
    try {
      const cacheKey = `emailCache_${address}`;
      localStorage.removeItem(cacheKey);
    } catch (e) {
      console.error('Failed to clear cache for address', address, e);
    }

    // 2. 后端异步删除
    try {
      await deleteMailboxApi(address);
    } catch (e) {
      console.error('Failed to delete mailbox from server', e);
    }

    // 3. 如果删除的是当前激活邮箱，则进行切换
    if (mailbox && mailbox.address === address) {
      // 过滤出未过期的邮箱
      const now = Date.now() / 1000;
      const valid = remaining.filter(m => m.expiresAt > now);
      
      if (valid.length > 0) {
        handleSetMailbox(valid[0]);
      } else {
        await createNewMailbox();
      }
    }
  };

  // 清除所有保存的邮箱并全部从后端删除
  const clearAllMailboxes = async () => {
    const listToClear = [...savedMailboxes];
    
    // 立即更新状态和本地存储
    setSavedMailboxes([]);
    localStorage.setItem('savedMailboxes', '[]');
    removeMailboxFromLocalStorage();
    
    // 清除所有邮件的缓存
    listToClear.forEach(m => {
      try {
        localStorage.removeItem(`emailCache_${m.address}`);
      } catch (e) {}
    });

    // 异步清除后端邮箱
    for (const m of listToClear) {
      try {
        await deleteMailboxApi(m.address);
      } catch (e) {
        console.error('Failed to delete mailbox from server', e);
      }
    }

    // 创建全新随机邮箱
    await createNewMailbox();
  };
  
  // 删除邮箱
  const deleteMailbox = () => {
    if (mailbox) {
      deleteMailboxFromSaved(mailbox.address);
    }
  };
  
  // 刷新邮件列表
  const refreshEmails = async () => {
    if (!mailbox) return;
    
    // 防止重复请求
    if (isEmailsLoading) return;
    
    setIsEmailsLoading(true);
    
    try {
      const result = await getEmails(mailbox.address);
      
      if (result.success) {
        setEmails(result.emails);
      } else if (result.notFound) {
        // 如果邮箱不存在，清除本地缓存并创建新邮箱
        try {
          // 直接调用handleMailboxNotFound函数
          await handleMailboxNotFound();
        } catch (error) {
          // 出错时也尝试清除缓存并创建新邮箱
          setMailbox(null);
          setEmails([]);
          setSelectedEmail(null);
          removeMailboxFromLocalStorage();
          clearEmailCache();
          
          // 刷新页面
          window.location.href = '/';
        }
      }
    } catch (error) {
      // 错误处理
      console.error('Error refreshing emails:', error);
    } finally {
      setIsEmailsLoading(false);
    }
  };
  
  // 自动刷新邮件
  useEffect(() => {
    if (!mailbox) return;
    
    // 首次加载邮件（无论autoRefresh是否开启）
    refreshEmails();
    
    // 如果自动刷新开启，则设置定时器
    let intervalId: number | undefined;
    if (autoRefresh) {
      intervalId = window.setInterval(refreshEmails, AUTO_REFRESH_INTERVAL);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [mailbox, autoRefresh]);
  
  // 处理邮箱不存在的情况
  const handleMailboxNotFound = async () => {
    try {
      // 清除之前的错误和成功信息
      setErrorMessage(null);
      setSuccessMessage(null);
      
      setSuccessMessage(t('mailbox.creatingNew'));
      
      // 清除当前邮箱信息
      setMailbox(null);
      setEmails([]);
      setSelectedEmail(null);
      removeMailboxFromLocalStorage();
      clearEmailCache();
      
      // 创建新邮箱
      try {
        const result = await createRandomMailbox();
        
        if (result.success && result.mailbox) {
          // 直接保存到localStorage，而不是通过setMailbox触发状态更新
          saveMailboxToLocalStorage(result.mailbox);
          
          // 直接刷新页面，让页面重新加载时从localStorage获取新邮箱
          window.location.href = '/'; // 使用href而不是reload，确保导航到首页
        } else {
          throw new Error('Failed to create mailbox');
        }
      } catch (error) {
        throw error;
      }
    } catch (error) {
      throw error;
    }
  };
  
  // 添加邮件到缓存
  const addToEmailCache = (emailId: string, email: Email, attachments: any[]) => {
    setEmailCache(prev => ({
      ...prev,
      [emailId]: {
        email,
        attachments,
        timestamp: Date.now()
      }
    }));
    
    // 保存到localStorage
    try {
      const mailboxAddress = mailbox?.address;
      if (mailboxAddress) {
        const cacheKey = `emailCache_${mailboxAddress}`;
        const updatedCache = {
          ...emailCache,
          [emailId]: {
            email,
            attachments,
            timestamp: Date.now()
          }
        };
        localStorage.setItem(cacheKey, JSON.stringify(updatedCache));
      }
    } catch (error) {
      console.error('Error saving email cache to localStorage:', error);
    }
  };
  
  // 清除邮件缓存
  const clearEmailCache = () => {
    setEmailCache({});
    
    // 清除localStorage中的缓存
    try {
      const mailboxAddress = mailbox?.address;
      if (mailboxAddress) {
        const cacheKey = `emailCache_${mailboxAddress}`;
        localStorage.removeItem(cacheKey);
      }
    } catch (error) {
      console.error('Error clearing email cache from localStorage:', error);
    }
  };
  
  // 从localStorage加载邮件缓存
  useEffect(() => {
    if (!mailbox) return;
    
    try {
      const cacheKey = `emailCache_${mailbox.address}`;
      const cachedData = localStorage.getItem(cacheKey);
      
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        setEmailCache(parsedCache);
      }
    } catch (error) {
      console.error('Error loading email cache from localStorage:', error);
    }
  }, [mailbox]);
  
  // 设置邮箱并保存到localStorage
  const handleSetMailbox = (newMailbox: Mailbox) => {
    setMailbox(newMailbox);
    saveMailboxToLocalStorage(newMailbox);
    
    // 同时更新/添加至已保存列表
    setSavedMailboxes(prev => {
      const exists = prev.some(m => m.address === newMailbox.address);
      let updated;
      if (exists) {
        updated = prev.map(m => m.address === newMailbox.address ? newMailbox : m);
      } else {
        updated = [...prev, newMailbox];
      }
      localStorage.setItem('savedMailboxes', JSON.stringify(updated));
      return updated;
    });
  };
  
  return (
    <MailboxContext.Provider
      value={{
        mailbox,
        setMailbox: handleSetMailbox,
        isLoading,
        emails,
        setEmails,
        selectedEmail,
        setSelectedEmail,
        isEmailsLoading,
        setIsEmailsLoading,
        autoRefresh,
        setAutoRefresh,
        createNewMailbox,
        deleteMailbox,
        refreshEmails,
        emailCache,
        addToEmailCache,
        clearEmailCache,
        handleMailboxNotFound,
        errorMessage,
        successMessage,
        savedMailboxes,
        deleteMailboxFromSaved,
        clearAllMailboxes
      }}
    >
      {/* 错误和成功提示 */}
      {(errorMessage || successMessage) && (
        <div className="fixed top-4 right-4 z-50 p-3 rounded-md shadow-lg max-w-md" style={{ backgroundColor: errorMessage ? '#FEE2E2' : '#ECFDF5', color: errorMessage ? '#991B1B' : '#065F46' }}>
          {errorMessage || successMessage}
        </div>
      )}
      {children}
    </MailboxContext.Provider>
  );
}; 