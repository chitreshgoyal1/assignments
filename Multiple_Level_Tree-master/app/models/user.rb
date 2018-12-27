class User < ActiveRecord::Base
  acts_as_tree
  attr_accessible :name, :parent_id
  validates_presence_of :name

  def all_children
    all = []
    self.children.each do |category|
      all << category
      root_children = category.all_children.flatten
      all << root_children unless root_children.empty?
    end
    return all.flatten
  end
end
